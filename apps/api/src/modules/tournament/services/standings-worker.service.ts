import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventBus } from '../../events/domain-event-bus.service';
import { ScoringRuleEngine, TieBreakerStrategy, TeamStanding } from '../engines/scoring-rule.engine';
import { MatchState } from '@prisma/client';
import { MetricsService } from './metrics.service';
import { randomUUID } from 'crypto';

@Injectable()
export class StandingsWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StandingsWorkerService.name);
  private readonly scoringEngine = new ScoringRuleEngine();
  private readonly tieBreaker = new TieBreakerStrategy();
  private readonly workerId = randomUUID();
  private readonly activeJobs = new Map<string, { leaseLost: boolean }>();
  private isProcessing = false;
  private queueInterval?: NodeJS.Timeout;
  private freezeCheckInterval?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: DomainEventBus,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    this.queueInterval = setInterval(() => {
      this.processQueue().catch((err) => {
        this.logger.error('Error running standings recompute worker queue interval:', err);
      });
    }, 10000);

    this.freezeCheckInterval = setInterval(() => {
      this.checkExpiredFreezes().catch((err) => {
        this.logger.error('Error running freeze check interval:', err);
      });
    }, 10000);
  }

  onModuleDestroy() {
    if (this.queueInterval) clearInterval(this.queueInterval);
    if (this.freezeCheckInterval) clearInterval(this.freezeCheckInterval);
  }

  /**
   * Scan for expired tournament freezes and auto-unfreeze them.
   */
  async checkExpiredFreezes() {
    const expiredTournaments = await this.prisma.tournament.findMany({
      where: {
        operationsFrozen: true,
        freezeExpiresAt: { lte: new Date() },
        deletedAt: null,
      },
    });

    for (const tournament of expiredTournaments) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const curr = await tx.tournament.findUnique({
            where: { id: tournament.id },
          });
          if (!curr || !curr.operationsFrozen || !curr.freezeExpiresAt || curr.freezeExpiresAt > new Date()) {
            return;
          }

          const now = new Date();
          const durationMs = curr.frozenAt ? now.getTime() - new Date(curr.frozenAt).getTime() : 0;

          const updated = await tx.tournament.update({
            where: { id: tournament.id },
            data: {
              operationsFrozen: false,
              freezeVersion: curr.freezeVersion + 1,
              freezeEndedAt: now,
              freezeEndReason: 'AUTO_EXPIRED',
            },
          });

          this.logger.log(`Tournament ${tournament.id} freeze expired. Auto-unfreezing via background checker.`);

          if (durationMs > 0) {
            this.metrics.recordHistogram('freeze_duration_ms', durationMs);
          }
          this.metrics.incrementCounter('freeze_expired_total');

          await this.eventBus.emit('TournamentFreezeExpired', {
            tournamentId: tournament.id,
            actorId: 'system',
            data: {
              expiredAt: now.toISOString(),
              freezeVersion: updated.freezeVersion,
            },
          });

          await this.eventBus.emit('TournamentStatusChanged', {
            tournamentId: tournament.id,
            actorId: 'system',
            data: {
              from: `FROZEN:true_v${curr.freezeVersion}`,
              to: `FROZEN:false_v${updated.freezeVersion}`,
              expired: true,
            },
          });
        });
      } catch (err) {
        this.logger.error(`Failed to auto-unfreeze tournament ${tournament.id}:`, err);
      }
    }
  }

  /**
   * Enqueues a recomputation job.
   */
  async enqueueJob(scope: 'ROOM' | 'STAGE', scopeId: string) {
    const job = await this.prisma.standingsRecomputeJob.create({
      data: {
        scope,
        scopeId,
        status: 'PENDING',
      },
    });

    this.logger.log(`Enqueued standings recompute job: id=${job.id} scope=${scope} scopeId=${scopeId}`);
    
    // Trigger queue processing out-of-band
    this.processQueue().catch((err) => {
      this.logger.error('Error running standings recompute worker queue:', err);
    });
  }

  /**
   * Process pending jobs in the queue.
   */
  async processQueue() {
    // Record current queue depth metric
    const queueDepth = await this.prisma.standingsRecomputeJob.count({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
    });
    this.metrics.setGauge('worker_queue_depth', queueDepth);

    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        const candidate = await this.prisma.standingsRecomputeJob.findFirst({
          where: {
            OR: [
              {
                status: 'PENDING',
                OR: [
                  { nextAttemptAt: null },
                  { nextAttemptAt: { lte: new Date() } },
                ],
              },
              {
                status: 'PROCESSING',
                leasedUntil: { lt: new Date() },
              },
            ],
          },
          orderBy: { createdAt: 'asc' },
        });

        if (!candidate) break;

        // If candidate lease expired, check if we exceeded max retries
        if (candidate.status === 'PROCESSING') {
          const nextRetry = candidate.retryCount + 1;
          if (nextRetry >= 3) {
            this.logger.warn(`Standings recompute job ${candidate.id} lease expired and exceeded max retries (3). Routing to DLQ.`);
            await this.prisma.$transaction(async (tx) => {
              await tx.standingsRecomputeJob.update({
                where: { id: candidate.id },
                data: {
                  status: 'FAILED',
                  retryCount: nextRetry,
                  lastFailure: 'Lease expired, max retries (3) exceeded',
                  completedAt: new Date(),
                },
              });
              await tx.standingsDeadLetter.create({
                data: {
                  jobId: candidate.id,
                  payload: {
                    scope: candidate.scope,
                    scopeId: candidate.scopeId,
                    retryCount: nextRetry,
                    lastFailure: 'Lease expired, max retries (3) exceeded',
                  },
                  reason: 'Lease expired, max retries (3) exceeded',
                },
              });
            });
            this.metrics.incrementCounter('worker_lease_expired_total');
            continue;
          }
        }

        // Atomic lease claim
        const leaseDurationMs = 30000;
        const leasedUntil = new Date(Date.now() + leaseDurationMs);

        const updateResult = await this.prisma.standingsRecomputeJob.updateMany({
          where: {
            id: candidate.id,
            OR: [
              {
                status: 'PENDING',
                OR: [
                  { nextAttemptAt: null },
                  { nextAttemptAt: { lte: new Date() } },
                ],
              },
              {
                status: 'PROCESSING',
                leasedUntil: { lt: new Date() },
              },
            ],
          },
          data: {
            status: 'PROCESSING',
            workerId: this.workerId,
            leasedUntil,
            startedAt: new Date(),
            retryCount: candidate.status === 'PROCESSING' ? candidate.retryCount + 1 : candidate.retryCount,
          },
        });

        if (updateResult.count === 0) {
          // Another worker claimed it, search again
          continue;
        }

        await this.runJob(candidate.id);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async runJob(jobId: string) {
    const startTime = Date.now();

    const jobState = { leaseLost: false };
    this.activeJobs.set(jobId, jobState);

    // Start heartbeat
    let leaseExtensionCount = 0;
    const maxLeaseExtensionCount = 30; // 30 * 10s = 300s (5 mins) max lease

    const heartbeatInterval = setInterval(async () => {
      try {
        leaseExtensionCount++;
        if (leaseExtensionCount > maxLeaseExtensionCount) {
          this.logger.warn(`Job ${jobId} exceeded max lease duration. Force aborting lease.`);
          jobState.leaseLost = true;
          clearInterval(heartbeatInterval);
          return;
        }

        const updateResult = await this.prisma.standingsRecomputeJob.updateMany({
          where: {
            id: jobId,
            workerId: this.workerId,
            status: 'PROCESSING',
            leasedUntil: { gte: new Date() }, // Owner lease stealing prevention
          },
          data: { leasedUntil: new Date(Date.now() + 30000) },
        });

        if (updateResult.count === 0) {
          this.logger.error(`Heartbeat lease extension failed. Lease may have been stolen or expired for job ${jobId}.`);
          jobState.leaseLost = true;
          clearInterval(heartbeatInterval);
        }
      } catch (err) {
        this.logger.error(`Heartbeat failed for job ${jobId}:`, err);
      }
    }, 10000);

    try {
      const job = await this.prisma.standingsRecomputeJob.findUnique({
        where: { id: jobId },
      });
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      this.logger.log(`Running standings recompute job ${jobId} for scope ${job.scope} id ${job.scopeId}`);
      
      if (job.scope === 'ROOM') {
        await this.recomputeRoomStandings(job.scopeId, jobId);
      } else if (job.scope === 'STAGE') {
        await this.recomputeStageStandings(job.scopeId, jobId);
      }

      if (jobState.leaseLost) {
        throw new Error('Lease was lost or expired during execution.');
      }

      const elapsed = Date.now() - startTime;
      await this.prisma.standingsRecomputeJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      this.metrics.recordHistogram('standings_recalc_ms', elapsed);
      this.metrics.recordHistogram('worker_job_duration_ms', elapsed);
      this.logger.log(`Standings recompute job ${jobId} completed in ${elapsed}ms`);
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      this.metrics.recordHistogram('worker_job_duration_ms', elapsed);
      this.logger.error(`Standings recompute job ${jobId} failed:`, err);
      
      // Fetch current job stats
      const job = await this.prisma.standingsRecomputeJob.findUnique({ where: { id: jobId } });
      const nextRetryCount = job ? job.retryCount + 1 : 1;
      const shouldRetry = nextRetryCount <= 3 && !jobState.leaseLost;

      if (shouldRetry) {
        // Calculate exponential backoff with jitter:
        // Retry 1: 5s +/- random(0-2s) -> 3s to 7s
        // Retry 2: 30s +/- random(0-10s) -> 20s to 40s
        // Retry 3: 120s +/- random(0-20s) -> 100s to 140s
        let baseDelayMs = 0;
        let jitterWindowMs = 0;
        if (nextRetryCount === 1) {
          baseDelayMs = 5000;
          jitterWindowMs = 4000; // random offset of -2000 to +2000
        } else if (nextRetryCount === 2) {
          baseDelayMs = 30000;
          jitterWindowMs = 20000; // random offset of -10000 to +10000
        } else if (nextRetryCount === 3) {
          baseDelayMs = 120000;
          jitterWindowMs = 40000; // random offset of -20000 to +20000
        }

        const jitter = Math.random() * jitterWindowMs - (jitterWindowMs / 2);
        const delayMs = Math.max(0, baseDelayMs + jitter);
        const nextAttemptAt = new Date(Date.now() + delayMs);

        await this.prisma.standingsRecomputeJob.update({
          where: { id: jobId },
          data: {
            status: 'PENDING',
            retryCount: nextRetryCount,
            lastFailure: err.message || String(err),
            nextAttemptAt,
            completedAt: null,
            workerId: null,
            leasedUntil: null,
          },
        });
        
        this.metrics.incrementCounter('worker_retry_total');
      } else {
        // Move to Dead Letter Queue (DLQ) atomically
        await this.prisma.$transaction(async (tx) => {
          await tx.standingsRecomputeJob.update({
            where: { id: jobId },
            data: {
              status: 'FAILED',
              retryCount: nextRetryCount,
              lastFailure: err.message || String(err),
              completedAt: new Date(),
              workerId: null,
              leasedUntil: null,
            },
          });
          await tx.standingsDeadLetter.create({
            data: {
              jobId,
              payload: {
                scope: job?.scope || 'UNKNOWN',
                scopeId: job?.scopeId || 'UNKNOWN',
                retryCount: nextRetryCount,
                lastFailure: err.message || String(err),
              },
              reason: err.message || String(err),
            },
          });
        });
        this.metrics.incrementCounter('worker_lease_expired_total');
      }
    } finally {
      clearInterval(heartbeatInterval);
      this.activeJobs.delete(jobId);
    }
  }

  private async recomputeRoomStandings(roomId: string, jobId: string) {
    const startTimeSnapshot = Date.now();

    // 1. Fetch the Room with its Round and Stage context
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        round: {
          include: {
            stage: {
              include: {
                tournament: true,
              },
            },
          },
        },
      },
    });

    if (!room) throw new Error(`Room ${roomId} not found`);

    const tournament = room.round.stage.tournament;
    const config = (tournament.config || {}) as any;

    const scoringConfig = {
      placementPoints: config.pointTable || {},
      killMultiplier: config.killPoints || 0,
    };
    const tiebreakerConfig = config.tiebreaker || ['kills', 'placement'];

    // 2. Fetch all matches in the room (completed + live matches are eligible for room standings)
    const matches = await this.prisma.match.findMany({
      where: {
        roomId,
        state: { in: [MatchState.COMPLETED, MatchState.LIVE] },
      },
      include: {
        results: true,
      },
    });

    // 3. Aggregate performances by team
    const teamStandingsMap = new Map<string, { kills: number; placements: number[]; name: string }>();

    // Fetch team names for the room
    const teams = await this.prisma.team.findMany({
      where: {
        roomAssignments: {
          some: {
            roomId,
            action: { in: ['ASSIGNED', 'MOVED'] },
          },
        },
      },
    });
    
    for (const t of teams) {
      teamStandingsMap.set(t.id, { kills: 0, placements: [], name: t.name });
    }

    for (const match of matches) {
      for (const res of match.results) {
        let teamData = teamStandingsMap.get(res.teamId);
        if (!teamData) {
          // Fallback if team is not assigned but has results
          const tRecord = await this.prisma.team.findUnique({ where: { id: res.teamId } });
          teamData = { kills: 0, placements: [], name: tRecord?.name || 'Unknown Team' };
          teamStandingsMap.set(res.teamId, teamData);
        }
        teamData.kills += res.kills;
        teamData.placements.push(res.placement);
      }
    }

    // 4. Calculate total points and build standings objects
    const standings: TeamStanding[] = [];
    for (const [teamId, data] of teamStandingsMap.entries()) {
      let totalPoints = 0;
      for (const p of data.placements) {
        const placementPoints = scoringConfig.placementPoints[String(p)] ?? 0;
        totalPoints += placementPoints;
      }
      totalPoints += data.kills * scoringConfig.killMultiplier;

      standings.push({
        teamId,
        teamName: data.name,
        points: totalPoints,
        kills: data.kills,
        placements: data.placements,
      });
    }

    // 5. Deterministic Sort using tie-breaker priority chain
    const sorted = this.tieBreaker.sort(standings, tiebreakerConfig);

    // 6. Write snapshot atomically with monotonic versioning (version = previous + 1)
    const jobState = this.activeJobs.get(jobId);
    if (jobState?.leaseLost) {
      throw new Error(`Standings recompute aborted: lease was lost or expired for job ${jobId}`);
    }

    await this.prisma.$transaction(async (tx) => {
      if (jobState?.leaseLost) {
        throw new Error(`Standings recompute transaction aborted: lease was lost or expired for job ${jobId}`);
      }

      const latest = await tx.roomStandingSnapshot.findFirst({
        where: { roomId },
        orderBy: { version: 'desc' },
      });
      const nextVersion = latest ? latest.version + 1 : 1;

      // Deactivate previous active snapshots
      await tx.roomStandingSnapshot.updateMany({
        where: { roomId, active: true },
        data: { active: false },
      });

      await tx.roomStandingSnapshot.create({
        data: {
          roomId,
          version: nextVersion,
          standings: sorted as any,
          active: true,
        },
      });

      this.metrics.recordHistogram('snapshot_generation_ms', Date.now() - startTimeSnapshot);
      this.metrics.incrementCounter('snapshot_activation_total');

      // Emit event
      await this.eventBus.emit('StandingsChanged', {
        tournamentId: tournament.id,
        actorId: 'system',
        data: {
          scope: 'ROOM',
          scopeId: roomId,
          version: nextVersion,
          standings: sorted,
        },
      });
    });
  }

  private async recomputeStageStandings(stageId: string, jobId: string) {
    const startTimeSnapshot = Date.now();

    // 1. Fetch Stage and Tournament config
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      include: {
        tournament: true,
      },
    });

    if (!stage) throw new Error(`Stage ${stageId} not found`);

    const tournament = stage.tournament;
    const config = (tournament.config || {}) as any;

    const scoringConfig = {
      placementPoints: config.pointTable || {},
      killMultiplier: config.killPoints || 0,
    };
    const tiebreakerConfig = config.tiebreaker || ['kills', 'placement'];

    // 2. Fetch all COMPLETED matches in this Stage (Stage level standings = completed only)
    const matches = await this.prisma.match.findMany({
      where: {
        room: {
          round: {
            stageId,
          },
        },
        state: MatchState.COMPLETED,
      },
      include: {
        results: true,
      },
    });

    // 3. Aggregate
    const teamStandingsMap = new Map<string, { kills: number; placements: number[]; name: string }>();

    for (const match of matches) {
      for (const res of match.results) {
        let teamData = teamStandingsMap.get(res.teamId);
        if (!teamData) {
          const tRecord = await this.prisma.team.findUnique({ where: { id: res.teamId } });
          teamData = { kills: 0, placements: [], name: tRecord?.name || 'Unknown Team' };
          teamStandingsMap.set(res.teamId, teamData);
        }
        teamData.kills += res.kills;
        teamData.placements.push(res.placement);
      }
    }

    const standings: TeamStanding[] = [];
    for (const [teamId, data] of teamStandingsMap.entries()) {
      let totalPoints = 0;
      for (const p of data.placements) {
        const placementPoints = scoringConfig.placementPoints[String(p)] ?? 0;
        totalPoints += placementPoints;
      }
      totalPoints += data.kills * scoringConfig.killMultiplier;

      standings.push({
        teamId,
        teamName: data.name,
        points: totalPoints,
        kills: data.kills,
        placements: data.placements,
      });
    }

    // 4. Sort
    const sorted = this.tieBreaker.sort(standings, tiebreakerConfig);

    // 5. Save Monotonic Snapshot
    const jobState = this.activeJobs.get(jobId);
    if (jobState?.leaseLost) {
      throw new Error(`Standings recompute aborted: lease was lost or expired for job ${jobId}`);
    }

    await this.prisma.$transaction(async (tx) => {
      if (jobState?.leaseLost) {
        throw new Error(`Standings recompute transaction aborted: lease was lost or expired for job ${jobId}`);
      }

      const latest = await tx.stageStandingSnapshot.findFirst({
        where: { stageId },
        orderBy: { version: 'desc' },
      });
      const nextVersion = latest ? latest.version + 1 : 1;

      // Deactivate previous active snapshots
      await tx.stageStandingSnapshot.updateMany({
        where: { stageId, active: true },
        data: { active: false },
      });

      await tx.stageStandingSnapshot.create({
        data: {
          stageId,
          version: nextVersion,
          standings: sorted as any,
          active: true,
        },
      });

      this.metrics.recordHistogram('snapshot_generation_ms', Date.now() - startTimeSnapshot);
      this.metrics.incrementCounter('snapshot_activation_total');

      // Emit event
      await this.eventBus.emit('StandingsChanged', {
        tournamentId: tournament.id,
        actorId: 'system',
        data: {
          scope: 'STAGE',
          scopeId: stageId,
          version: nextVersion,
          standings: sorted,
        },
      });
    });
  }
}
