import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventService } from '../../events/domain-event.service';
import { RoomMutationPolicy } from '../policies/room-mutation.policy';
import { QualificationRunService } from './qualification-run.service';
import {
  RandomAllocationStrategy,
  SeededAllocationStrategy,
  SequentialAllocationStrategy,
} from '../strategies/room-allocation.strategy';
import {
  ScoringRuleEngine,
  MatchPerformance,
  ScoringConfig,
  TieBreakerStrategy,
  TeamStanding,
} from '../engines/scoring-rule.engine';
import { TopXQualificationStrategy } from '../strategies/qualification.strategy';
import { TeamStatus, MatchState, RoomAssignmentAction } from '@prisma/client';

@Injectable()
export class TournamentEngineService {
  private readonly logger = new Logger(TournamentEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEvents: DomainEventService,
    private readonly policy: RoomMutationPolicy,
    private readonly qualificationRun: QualificationRunService,
    private readonly metrics: MetricsService,
  ) {}

  // ── Module 1: Room Allocation ─────────────────────────────────────────────

  /**
   * Allocates approved teams deterministically or randomly into stage rooms.
   */
  async allocateRooms(
    stageId: string,
    strategyName: 'SEQUENTIAL' | 'RANDOM' | 'SEEDED',
    actorId: string,
    seed?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const stage = await tx.stage.findFirst({
        where: { id: stageId, deletedAt: null },
        include: {
          tournament: { select: { operationsFrozen: true, freezeScopes: true } },
          rounds: {
            where: { roundNumber: 1 },
            include: { rooms: { where: { deletedAt: null } } },
          },
        },
      });

      if (!stage) {
        throw new NotFoundException(`Stage ${stageId} not found.`);
      }

      if (
        stage.tournament.operationsFrozen &&
        (stage.tournament.freezeScopes.includes('ALL') ||
          stage.tournament.freezeScopes.includes('ROOMS'))
      ) {
        this.metrics.incrementCounter('freeze_operations_blocked_total');
        throw new ForbiddenException(
          `Tournament operations are frozen for scope: ROOMS.`,
        );
      }

      const round1 = stage.rounds[0];
      if (!round1 || round1.rooms.length === 0) {
        throw new ConflictException('Stage must have at least one room in Round 1.');
      }

      // Check if any rooms in this round are locked
      const hasLockedRooms = round1.rooms.some((rm) => rm.isLocked);
      if (hasLockedRooms) {
        throw new ConflictException('Cannot re-allocate rooms. Some rooms are locked.');
      }

      // Fetch all approved teams in the tournament
      const teams = await tx.team.findMany({
        where: { tournamentId: stage.tournamentId, status: TeamStatus.APPROVED, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });

      if (teams.length === 0) {
        throw new ConflictException('No approved teams available to allocate.');
      }

      // Select strategy
      let strategy;
      if (strategyName === 'RANDOM') {
        strategy = new RandomAllocationStrategy();
      } else if (strategyName === 'SEEDED') {
        strategy = new SeededAllocationStrategy();
      } else {
        strategy = new SequentialAllocationStrategy();
      }

      const roomCapacity = round1.rooms[0].capacity;
      const allocatedRooms = strategy.allocate(teams, roomCapacity, seed);

      const roomIds = round1.rooms.map((r) => r.id);

      // Append REMOVED logs for any current allocations in these rooms
      const activeAssignments = await tx.roomAssignment.findMany({
        where: { roomId: { in: roomIds }, action: { in: [RoomAssignmentAction.ASSIGNED, RoomAssignmentAction.MOVED] } },
      });

      for (const assignment of activeAssignments) {
        await tx.roomAssignment.create({
          data: {
            teamId: assignment.teamId,
            roomId: assignment.roomId,
            action: RoomAssignmentAction.REMOVED,
            actorId,
            reason: 'Re-allocation reset',
            version: assignment.version + 1,
          },
        });
      }

      // Create new assignments
      for (let rIdx = 0; rIdx < allocatedRooms.length; rIdx++) {
        const targetRoom = round1.rooms[rIdx];
        if (!targetRoom) continue; // Skip if group count exceeds room count

        const group = allocatedRooms[rIdx];
        for (const team of group) {
          const latest = await tx.roomAssignment.findFirst({
            where: { teamId: team.id },
            orderBy: { version: 'desc' },
          });
          const nextVersion = (latest?.version || 0) + 1;

          await tx.roomAssignment.create({
            data: {
              teamId: team.id,
              roomId: targetRoom.id,
              action: RoomAssignmentAction.ASSIGNED,
              actorId,
              reason: `Initial room allocation (${strategyName})`,
              version: nextVersion,
            },
          });
        }
      }

      this.logger.log(`Allocated ${teams.length} teams into stage ${stageId} using ${strategyName}`);
      return { success: true, roomsAllocated: Math.min(allocatedRooms.length, round1.rooms.length) };
    });
  }

  // ── Module 2: Room Manual Overrides ────────────────────────────────────────

  /**
   * Manually moves a team between rooms. Enforces capacity and locking policies.
   */
  async moveTeam(
    teamId: string,
    fromRoomId: string,
    toRoomId: string,
    actorId: string,
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Validate source and target room status via policies
      await this.policy.assertRoomMutable(fromRoomId);
      await this.policy.assertRoomMutable(toRoomId, 1); // target room gets +1 team

      // Read team's latest assignment
      const latest = await tx.roomAssignment.findFirst({
        where: { teamId },
        orderBy: { version: 'desc' },
      });

      if (!latest || latest.roomId !== fromRoomId || latest.action === RoomAssignmentAction.REMOVED) {
        throw new ConflictException(`Team ${teamId} is not actively assigned to source room ${fromRoomId}.`);
      }

      // Create append-only MOVED record
      const nextVersion = latest.version + 1;
      const assignment = await tx.roomAssignment.create({
        data: {
          teamId,
          roomId: toRoomId,
          action: RoomAssignmentAction.MOVED,
          previousRoomId: fromRoomId,
          reason: reason || 'Manual administrative transfer',
          actorId,
          version: nextVersion,
        },
      });

      this.logger.log(`Admin ${actorId} moved team ${teamId} from room ${fromRoomId} to ${toRoomId}`);
      return assignment;
    });
  }

  /**
   * Locks or unlocks a room. Prevents manual overrides if locked.
   */
  async toggleRoomLock(roomId: string, isLocked: boolean, actorId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, deletedAt: null },
      include: {
        round: {
          include: {
            stage: {
              include: {
                tournament: { select: { operationsFrozen: true, freezeScopes: true } },
              },
            },
          },
        },
        matches: true,
      },
    });

    if (!room) {
      throw new NotFoundException(`Room ${roomId} not found.`);
    }

    const tournament = room.round.stage.tournament;
    if (
      tournament.operationsFrozen &&
      (tournament.freezeScopes.includes('ALL') ||
        tournament.freezeScopes.includes('ROOMS'))
    ) {
      this.metrics.incrementCounter('freeze_operations_blocked_total');
      throw new ForbiddenException(
        `Tournament operations are frozen for scope: ROOMS.`,
      );
    }

    if (!isLocked) {
      // Can only unlock if there are no completed matches
      const hasCompletedMatches = room.matches.some((m) => m.state === MatchState.COMPLETED);
      if (hasCompletedMatches) {
        throw new ConflictException('Cannot unlock a room with completed match records.');
      }
    }

    const updatedRoom = await this.prisma.room.update({
      where: { id: roomId },
      data: { isLocked },
    });

    // If locked, create RoomAssignment record of LOCKED state for audit trails
    if (isLocked) {
      const activeAssignments = await this.prisma.$queryRaw<Array<{ teamId: string; version: number }>>`
        SELECT "teamId", "version"
        FROM (
          SELECT "teamId", "roomId", "action", "version",
                 ROW_NUMBER() OVER (PARTITION BY "teamId" ORDER BY "version" DESC, "createdAt" DESC) as rn
          FROM "RoomAssignment"
        ) t
        WHERE rn = 1 AND "roomId" = ${roomId} AND "action" IN ('ASSIGNED', 'MOVED')
      `;

      for (const assign of activeAssignments) {
        await this.prisma.roomAssignment.create({
          data: {
            teamId: assign.teamId,
            roomId,
            action: RoomAssignmentAction.LOCKED,
            actorId,
            version: assign.version + 1,
            reason: 'Room configuration locked',
          },
        });
      }
    }

    this.logger.log(`Room ${roomId} lock status set to ${isLocked} by ${actorId}`);
    return updatedRoom;
  }

  // ── Module 4: Scoring Engine ───────────────────────────────────────────────

  /**
   * Enters results for a match, calculates scores, and completes the match.
   */
  async scoreMatch(matchId: string, performances: MatchPerformance[], actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { room: { include: { round: { include: { stage: { include: { tournament: true } } } } } } },
      });

      if (!match) {
        throw new NotFoundException(`Match ${matchId} not found.`);
      }

      // Check if room is locked or match can be scored
      await this.policy.assertRoomMutable(match.roomId);

      const tournament = match.room.round.stage.tournament;
      const config = tournament.config as any;

      const scoringConfig: ScoringConfig = {
        placementPoints: config.pointTable,
        killMultiplier: config.killPoints || 1,
      };

      const engine = new ScoringRuleEngine();
      const scoreBreakdowns = engine.calculateScores(performances, scoringConfig);

      // Clear previous results (in case of override)
      await tx.matchResult.deleteMany({ where: { matchId } });

      // Save match results
      await tx.matchResult.createMany({
        data: scoreBreakdowns.map((score) => {
          const perf = performances.find((p) => p.teamId === score.teamId)!;
          return {
            matchId,
            teamId: score.teamId,
            placement: perf.placement,
            kills: perf.kills,
            placementPoints: score.placementPoints,
            killsPoints: score.killPoints,
          };
        }),
      });

      // Set match state to completed
      await tx.match.update({
        where: { id: matchId },
        data: { state: MatchState.COMPLETED },
      });

      this.logger.log(`Scored match ${matchId} for ${performances.length} teams`);
      return scoreBreakdowns;
    });
  }

  // ── Module 5: Qualification Engine ──────────────────────────────────────────

  /**
   * Evaluates stage standings, resolves tiebreakers, and saves qualification decisions.
   */
  async qualifyStage(
    stageId: string,
    qualifyCount: number,
    actorId: string,
    tieBreakers: Array<'kills' | 'placement'> = ['kills', 'placement'],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const stage = await tx.stage.findFirst({
        where: { id: stageId, deletedAt: null },
        include: { tournament: { select: { id: true, operationsFrozen: true, freezeScopes: true } } },
      });

      if (!stage) {
        throw new NotFoundException(`Stage ${stageId} not found.`);
      }

      if (
        stage.tournament.operationsFrozen &&
        (stage.tournament.freezeScopes.includes('ALL') ||
          stage.tournament.freezeScopes.includes('ROOMS'))
      ) {
        this.metrics.incrementCounter('freeze_operations_blocked_total');
        throw new ForbiddenException(
          `Tournament operations are frozen for scope: ROOMS.`,
        );
      }

      // 1. Fetch all match results in this stage
      const results = await tx.matchResult.findMany({
        where: {
          match: {
            room: {
              round: {
                stageId,
              },
            },
          },
        },
        include: {
          team: { select: { name: true } },
        },
      });

      // 2. Aggregate standings by team
      const teamMap = new Map<string, TeamStanding>();
      for (const res of results) {
        if (!teamMap.has(res.teamId)) {
          teamMap.set(res.teamId, {
            teamId: res.teamId,
            teamName: res.team.name,
            points: 0,
            kills: 0,
            placements: [],
          });
        }
        const standing = teamMap.get(res.teamId)!;
        standing.points += res.placementPoints + res.killsPoints;
        standing.kills += res.kills;
        standing.placements.push(res.placement);
      }

      const standingsList = Array.from(teamMap.values());

      // 3. Apply Tie-Breaker standings sorting
      const sorter = new TieBreakerStrategy();
      const sortedStandings = sorter.sort(standingsList, tieBreakers);

      // 4. Run top-x qualification
      const qualifier = new TopXQualificationStrategy();
      const { qualified, eliminated } = qualifier.qualify(sortedStandings, qualifyCount);

      // 5. Record the QualificationRun for reproducibility
      const configSnapshot = {
        strategy: 'TOP_X_PER_ROOM',
        tieBreaker: tieBreakers,
      };

      const run = await tx.qualificationRun.create({
        data: {
          stageId,
          strategy: 'TOP_X_PER_ROOM',
          results: {
            standings: sortedStandings,
            config: configSnapshot,
          } as any,
        },
      });

      // 6. Save decisions to DB (overwriting previous run if exists)
      await tx.qualificationDecision.deleteMany({ where: { stageId } });
      
      await tx.qualificationDecision.createMany({
        data: [
          ...qualified.map((t, idx) => ({
            teamId: t.teamId,
            stageId,
            decision: 'QUALIFIED' as const,
            source: 'AUTO' as const,
            beforeRank: idx + 1,
            afterRank: idx + 1,
            approvedBy: actorId,
            reason: `Top-${qualifyCount} standings qualification run Ref: ${run.id}`,
          })),
          ...eliminated.map((t, idx) => ({
            teamId: t.teamId,
            stageId,
            decision: 'ELIMINATED' as const,
            source: 'AUTO' as const,
            beforeRank: qualified.length + idx + 1,
            afterRank: qualified.length + idx + 1,
            approvedBy: actorId,
            reason: `Standings qualification elimination run Ref: ${run.id}`,
          })),
        ],
      });

      this.logger.log(`Qualified stage ${stageId}: ${qualified.length} qualified, ${eliminated.length} eliminated.`);
      return { runId: run.id, qualifiedCount: qualified.length, eliminatedCount: eliminated.length };
    });
  }
}
