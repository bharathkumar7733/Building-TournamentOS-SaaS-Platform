import { Injectable, NotFoundException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventBus } from '../../events/domain-event-bus.service';
import { MatchState, TeamStatus, Prisma } from '@prisma/client';
import { MatchStateMachine } from '../engines/match-state-machine';
import { ScoringRuleEngine } from '../engines/scoring-rule.engine';
import { MetricsService } from './metrics.service';

@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);
  private readonly scoringEngine = new ScoringRuleEngine();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: DomainEventBus,
    private readonly metrics: MetricsService,
  ) {}

  private async assertTournamentNotFrozen(
    tournamentId: string,
    scope: 'MATCH_CONTROL' | 'SCORING',
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      select: { operationsFrozen: true, freezeScopes: true, freezeExpiresAt: true, freezeVersion: true, frozenAt: true },
    });
    if (!tournament) {
      throw new NotFoundException(`Tournament ${tournamentId} not found.`);
    }
    if (tournament.operationsFrozen) {
      const now = new Date();
      if (tournament.freezeExpiresAt && new Date(tournament.freezeExpiresAt) <= now) {
        // Self-heal: inline unfreeze
        const durationMs = tournament.frozenAt ? now.getTime() - new Date(tournament.frozenAt).getTime() : 0;
        const updated = await tx.tournament.update({
          where: { id: tournamentId },
          data: {
            operationsFrozen: false,
            freezeVersion: tournament.freezeVersion + 1,
            freezeEndedAt: now,
            freezeEndReason: 'AUTO_EXPIRED',
          },
        });

        this.logger.log(`Tournament ${tournamentId} freeze expired. Inline self-healing unfreeze triggered.`);

        if (durationMs > 0) {
          this.metrics.recordHistogram('freeze_duration_ms', durationMs);
        }
        this.metrics.incrementCounter('freeze_expired_total');

        await this.eventBus.emit('TournamentFreezeExpired', {
          tournamentId,
          actorId: 'system',
          data: {
            expiredAt: now.toISOString(),
            freezeVersion: updated.freezeVersion,
          },
        });

        await this.eventBus.emit('TournamentStatusChanged', {
          tournamentId,
          actorId: 'system',
          data: {
            from: `FROZEN:true_v${tournament.freezeVersion}`,
            to: `FROZEN:false_v${updated.freezeVersion}`,
            expired: true,
          },
        });

        return; // Freeze is auto-expired, proceed!
      }

      if (
        tournament.freezeScopes.includes('ALL') ||
        tournament.freezeScopes.includes(scope)
      ) {
        this.metrics.incrementCounter('freeze_operations_blocked_total');
        throw new ForbiddenException(
          `Tournament operations are frozen for scope: ${scope}.`,
        );
      }
    }
  }

  /**
   * Transition match status using the state machine.
   */
  async transitionState(matchId: string, targetState: MatchState, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { room: { include: { round: { include: { stage: { include: { tournament: true } } } } } } },
      });

      if (!match) {
        throw new NotFoundException(`Match ${matchId} not found`);
      }

      // Check freeze
      await this.assertTournamentNotFrozen(
        match.room.round.stage.tournamentId,
        'MATCH_CONTROL',
        tx,
      );

      // 1. Validate transition
      MatchStateMachine.validateTransition(match.state, targetState);

      const now = new Date();
      const updateData: Prisma.MatchUpdateInput = {
        state: targetState,
      };

      let eventType = '';
      const eventPayload: any = { matchId, roomId: match.roomId };

      // 2. Handle timestamps and offsets
      if (targetState === MatchState.LIVE) {
        if (match.state === MatchState.UPCOMING) {
          updateData.startedAt = now;
          eventType = 'MatchStarted';
          eventPayload.startedAt = now.toISOString();
          this.metrics.incrementCounter('match_start_total');
        } else if (match.state === MatchState.PAUSED) {
          // Resuming from PAUSED
          const pausedAt = match.pausedAt ? new Date(match.pausedAt).getTime() : now.getTime();
          const pausedDuration = now.getTime() - pausedAt;
          updateData.pausedDurationMs = match.pausedDurationMs + pausedDuration;
          updateData.pausedAt = null; // reset
          eventType = 'MatchResumed';
          eventPayload.resumedAt = now.toISOString();
        }
      } else if (targetState === MatchState.PAUSED) {
        updateData.pausedAt = now;
        eventType = 'MatchPaused';
        eventPayload.pausedAt = now.toISOString();
        this.metrics.incrementCounter('match_pause_total');
      } else if (targetState === MatchState.COMPLETED) {
        updateData.endedAt = now;
        eventType = 'MatchCompleted';
        eventPayload.endedAt = now.toISOString();
        this.metrics.incrementCounter('match_complete_total');
      } else if (targetState === MatchState.ABANDONED) {
        updateData.endedAt = now;
        eventType = 'MatchAbandoned';
        eventPayload.endedAt = now.toISOString();
      }

      // 3. Persist match transition
      const updatedMatch = await tx.match.update({
        where: { id: matchId },
        data: updateData,
      });

      // 4. Log to MatchEvent ledger
      await tx.matchEvent.create({
        data: {
          matchId,
          type: targetState,
          payload: { from: match.state, to: targetState, occurredAt: now.toISOString() },
          actorId,
        },
      });

      // 5. Emit event
      await this.eventBus.emit(eventType as any, {
        tournamentId: match.room.round.stage.tournamentId,
        actorId,
        data: eventPayload,
      });

      this.logger.log(`Match ${matchId} transitioned from ${match.state} to ${targetState}`);
      return updatedMatch;
    });
  }

  /**
   * Writes score updates for a team inside a match.
   * Enforces optimistic version locking and placement uniqueness.
   */
  async updateScore(
    matchId: string,
    teamId: string,
    kills: number,
    placement: number,
    clientVersion: number,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Fetch match and verify it is LIVE
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { room: { include: { round: { include: { stage: { include: { tournament: true } } } } } } },
      });

      if (!match) {
        throw new NotFoundException(`Match ${matchId} not found`);
      }

      const tournament = match.room.round.stage.tournament;

      // Check freeze
      await this.assertTournamentNotFrozen(tournament.id, 'SCORING', tx);

      MatchStateMachine.assertCanEditScore(match.state);
      const config = (tournament.config || {}) as any;
      const placementPoints = config.pointTable?.[String(placement)] ?? 0;
      const killPoints = kills * (config.killPoints || 0);

      // 2. Optimistic locking version check
      const currentResult = await tx.matchResult.findUnique({
        where: { matchId_teamId: { matchId, teamId } },
      });

      if (currentResult) {
        if (currentResult.scoreVersion !== clientVersion) {
          this.metrics.incrementCounter('score_conflict_total');
          throw new ConflictException(
            `Optimistic Lock Conflict: Score version mismatch (expected: ${currentResult.scoreVersion}, got: ${clientVersion}).`,
          );
        }
      } else {
        // First version is 1
        if (clientVersion !== 1) {
          this.metrics.incrementCounter('score_conflict_total');
          throw new ConflictException(
            `Optimistic Lock Conflict: Score version mismatch (expected: 1, got: ${clientVersion}).`,
          );
        }
      }

      // 3. Validate unique placement per match
      if (placement > 0) {
        const duplicatePlacement = await tx.matchResult.findFirst({
          where: {
            matchId,
            placement,
            teamId: { not: teamId },
          },
        });

        if (duplicatePlacement) {
          throw new ConflictException(
            `Placement rank ${placement} is already assigned to another team in this match.`,
          );
        }
      }

      const nextVersion = currentResult ? currentResult.scoreVersion + 1 : 1;

      // 4. Save/update MatchResult
      const result = await tx.matchResult.upsert({
        where: { matchId_teamId: { matchId, teamId } },
        create: {
          matchId,
          teamId,
          kills,
          placement,
          placementPoints,
          killsPoints: killPoints,
          scoreVersion: nextVersion,
        },
        update: {
          kills,
          placement,
          placementPoints,
          killsPoints: killPoints,
          scoreVersion: nextVersion,
        },
      });

      // 5. Append to MatchEvent ledger
      await tx.matchEvent.create({
        data: {
          matchId,
          type: 'SCORE_UPDATE',
          payload: {
            teamId,
            kills,
            placement,
            points: placementPoints + killPoints,
            scoreVersion: nextVersion,
          },
          actorId,
        },
      });

      this.metrics.incrementCounter('score_updates_total');

      // 6. Emit event
      await this.eventBus.emit('ScoreUpdated', {
        tournamentId: tournament.id,
        actorId,
        data: {
          matchId,
          teamId,
          kills,
          placement,
          points: placementPoints + killPoints,
          scoreVersion: nextVersion,
        },
      });

      this.logger.log(`Score updated for match ${matchId} team ${teamId}: version=${nextVersion}`);
      return result;
    });
  }

  /**
   * Reverts match scores for a team to a previous value or reset state.
   * Increments the scoreVersion and registers a reversal event in the ledger.
   */
  async revertScore(
    matchId: string,
    teamId: string,
    kills: number,
    placement: number,
    clientVersion: number,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Fetch match and check status is LIVE
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { room: { include: { round: { include: { stage: { include: { tournament: true } } } } } } },
      });

      if (!match) {
        throw new NotFoundException(`Match ${matchId} not found`);
      }

      const tournament = match.room.round.stage.tournament;

      // Check freeze
      await this.assertTournamentNotFrozen(tournament.id, 'SCORING', tx);

      MatchStateMachine.assertCanEditScore(match.state);
      const config = (tournament.config || {}) as any;
      const placementPoints = config.pointTable?.[String(placement)] ?? 0;
      const killPoints = kills * (config.killPoints || 0);

      // 2. Concurrency Lock check
      const currentResult = await tx.matchResult.findUnique({
        where: { matchId_teamId: { matchId, teamId } },
      });

      if (!currentResult) {
        throw new NotFoundException(`No score results found to revert for team ${teamId} in match ${matchId}`);
      }

      if (currentResult.scoreVersion !== clientVersion) {
        this.metrics.incrementCounter('score_conflict_total');
        throw new ConflictException(
          `Optimistic Lock Conflict on Revert: Version mismatch (expected: ${currentResult.scoreVersion}, got: ${clientVersion}).`,
        );
      }

      // 3. Unique placement check
      if (placement > 0) {
        const duplicatePlacement = await tx.matchResult.findFirst({
          where: {
            matchId,
            placement,
            teamId: { not: teamId },
          },
        });

        if (duplicatePlacement) {
          throw new ConflictException(
            `Placement rank ${placement} is already assigned to another team on revert.`,
          );
        }
      }

      const nextVersion = currentResult.scoreVersion + 1;

      // 4. Update the result (never delete, only update values to the reverted state)
      const revertedResult = await tx.matchResult.update({
        where: { matchId_teamId: { matchId, teamId } },
        data: {
          kills,
          placement,
          placementPoints,
          killsPoints: killPoints,
          scoreVersion: nextVersion,
        },
      });

      // 5. Append reversal event to MatchEvent ledger
      await tx.matchEvent.create({
        data: {
          matchId,
          type: 'REVERT',
          payload: {
            teamId,
            revertedFrom: {
              kills: currentResult.kills,
              placement: currentResult.placement,
              version: currentResult.scoreVersion,
            },
            revertedTo: {
              kills,
              placement,
              version: nextVersion,
            },
            occurredAt: new Date().toISOString(),
          },
          actorId,
        },
      });

      // 6. Emit event
      await this.eventBus.emit('ScoreReverted', {
        tournamentId: tournament.id,
        actorId,
        data: {
          matchId,
          teamId,
          kills,
          placement,
          points: placementPoints + killPoints,
          scoreVersion: nextVersion,
        },
      });

      this.logger.log(`Score reverted for match ${matchId} team ${teamId}: version=${nextVersion}`);
      return revertedResult;
    });
  }

  /**
   * Retrieves match status, scores, current version and duration details.
   */
  async getMatchStatus(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        results: {
          include: {
            team: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException(`Match ${matchId} not found`);
    }

    const maxVersion = match.results.reduce((max, r) => Math.max(max, r.scoreVersion), 0);

    return {
      matchId: match.id,
      roomId: match.roomId,
      state: match.state,
      scheduledAt: match.scheduledAt,
      startedAt: match.startedAt,
      endedAt: match.endedAt,
      pausedAt: match.pausedAt,
      pausedDurationMs: match.pausedDurationMs,
      version: maxVersion || 1,
      results: match.results.map((r) => ({
        teamId: r.teamId,
        teamName: r.team.name,
        kills: r.kills,
        placement: r.placement,
        points: r.placementPoints + r.killsPoints,
        version: r.scoreVersion,
      })),
    };
  }
}
