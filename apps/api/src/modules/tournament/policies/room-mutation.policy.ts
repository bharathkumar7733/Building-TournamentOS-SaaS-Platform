import { Injectable, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsService } from '../services/metrics.service';
import { DomainEventBus } from '../../events/domain-event-bus.service';

@Injectable()
export class RoomMutationPolicy {
  private readonly logger = new Logger(RoomMutationPolicy.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * Validates if a room can undergo mutations (team moves, additions, deletions, or lock toggles).
   * Enforces:
   *   1. Room cannot be locked.
   *   2. Room cannot have completed matches.
   *   3. Room capacity cannot be exceeded.
   *
   * @throws ForbiddenException if room is locked.
   * @throws ConflictException if room has completed matches or capacity is breached.
   */
  async assertRoomMutable(roomId: string, teamsToAddCount = 0): Promise<void> {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, deletedAt: null },
      include: {
        round: {
          include: {
            stage: {
              include: {
                tournament: { select: { id: true, operationsFrozen: true, freezeScopes: true, freezeExpiresAt: true, freezeVersion: true, frozenAt: true } },
              },
            },
          },
        },
        matches: { select: { state: true } },
      },
    });

    if (!room) {
      throw new ConflictException(`Room ${roomId} not found.`);
    }

    const tournament = room.round.stage.tournament;
    if (tournament.operationsFrozen) {
      const now = new Date();
      if (tournament.freezeExpiresAt && new Date(tournament.freezeExpiresAt) <= now) {
        // Self-heal: inline unfreeze
        const durationMs = tournament.frozenAt ? now.getTime() - new Date(tournament.frozenAt).getTime() : 0;
        const updated = await this.prisma.tournament.update({
          where: { id: tournament.id },
          data: {
            operationsFrozen: false,
            freezeVersion: tournament.freezeVersion + 1,
            freezeEndedAt: now,
            freezeEndReason: 'AUTO_EXPIRED',
          },
        });

        this.logger.log(`Tournament ${tournament.id} freeze expired. Inline self-healing unfreeze triggered during room mutability assertion.`);

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
            from: `FROZEN:true_v${tournament.freezeVersion}`,
            to: `FROZEN:false_v${updated.freezeVersion}`,
            expired: true,
          },
        });
      } else if (
        tournament.freezeScopes.includes('ALL') ||
        tournament.freezeScopes.includes('ROOMS')
      ) {
        this.metrics.incrementCounter('freeze_operations_blocked_total');
        throw new ForbiddenException(
          `Tournament operations are frozen for scope: ROOMS.`,
        );
      }
    }

    // 1. Lock Check
    if (room.isLocked) {
      throw new ForbiddenException(`Room ${room.roomNumber} is locked and cannot be modified.`);
    }

    // 2. Completed Match Check
    const hasCompletedMatches = room.matches.some((m) => m.state === 'COMPLETED');
    if (hasCompletedMatches) {
      throw new ConflictException(
        `Room ${room.roomNumber} has completed matches and cannot be modified.`,
      );
    }

    // 3. Capacity Check (resolving active assignments from append-only logs)
    const activeAssignments = await this.prisma.$queryRaw<Array<{ teamId: string }>>`
      SELECT "teamId"
      FROM (
        SELECT "teamId", "roomId", "action",
         ROW_NUMBER() OVER (PARTITION BY "teamId" ORDER BY "version" DESC, "createdAt" DESC) as rn
        FROM "RoomAssignment"
      ) t
      WHERE rn = 1 AND "roomId" = ${roomId} AND "action" IN ('ASSIGNED', 'MOVED')
    `;

    const currentTeamsCount = activeAssignments.length;
    if (currentTeamsCount + teamsToAddCount > room.capacity) {
      throw new ConflictException(
        `Room ${room.roomNumber} capacity exceeded. Max capacity is ${room.capacity} teams (currently contains ${currentTeamsCount}).`,
      );
    }
  }
}
