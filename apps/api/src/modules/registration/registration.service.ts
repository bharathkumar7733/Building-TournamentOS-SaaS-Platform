import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { DomainEventBus } from '../events/domain-event-bus.service';
import { TeamStatus, Prisma } from '@prisma/client';
import type {
  RegisterTeamInput,
  EditPendingTeamInput,
  RejectTeamInput,
  BulkApproveInput,
} from './dto/register-team.validator';
import { TournamentConfig } from '../tournament/types/tournament-config.types';
import { MetricsService } from '../tournament/services/metrics.service';

// ── Row-lock SQL helpers ────────────────────────────────────────────────────

/** Raw SQL to lock the tournament row inside a transaction (prevents capacity races). */
const LOCK_TOURNAMENT_SQL = Prisma.sql`
  SELECT id, status, config, "registrationStartsAt", "registrationEndsAt"
  FROM "Tournament"
  WHERE id = ${Prisma.empty}
  FOR UPDATE
`;

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEvents: DomainEventService,
    private readonly eventBus: DomainEventBus,
    private readonly metrics: MetricsService,
  ) {}

  private async assertTournamentNotFrozen(
    tournamentId: string,
    scope: 'REGISTRATION' | 'ROOMS' | 'SCORING' | 'MATCH_CONTROL',
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

        this.logger.log(`Tournament ${tournamentId} freeze expired. Inline self-healing unfreeze triggered during assertion.`);

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

        return; // Proceed!
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

  // ── PUBLIC: Register a team ───────────────────────────────────────────────

  /**
   * Registers a new team for a tournament.
   *
   * Safety guarantees:
   *   1. Wraps entire operation in a Prisma transaction.
   *   2. Issues SELECT FOR UPDATE on the Tournament row — blocks concurrent
   *      registrations from racing past the capacity check.
   *   3. Teams beyond maxTeams capacity are placed on the waitlist with an
   *      atomically-assigned waitlistPosition (persisted, never computed dynamically).
   *   4. Duplicate gameUid per tournament is caught at the DB level (@@unique constraint).
   *
   * @throws ForbiddenException if the registration window is closed
   * @throws BadRequestException if the tournament is not accepting registrations
   */
  async registerTeam(
    tournamentId: string,
    input: RegisterTeamInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          config: unknown;
          registrationStartsAt: Date | null;
          registrationEndsAt: Date | null;
          operationsFrozen: boolean;
          freezeScopes: any[];
          freezeExpiresAt: Date | null;
          freezeVersion: number;
          frozenAt: Date | null;
        }>
      >(
        Prisma.sql`
          SELECT id, status, config, "registrationStartsAt", "registrationEndsAt", "operationsFrozen", "freezeScopes", "freezeExpiresAt", "freezeVersion", "frozenAt"
          FROM "Tournament"
          WHERE id = ${tournamentId}
          FOR UPDATE
        `,
      );

      if (rows.length === 0) {
        throw new NotFoundException(`Tournament ${tournamentId} not found.`);
      }

      const tournament = rows[0];

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

          this.logger.log(`Tournament ${tournamentId} freeze expired. Inline self-healing unfreeze triggered during raw lock registration.`);

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
        } else if (
          tournament.freezeScopes.includes('ALL') ||
          tournament.freezeScopes.includes('REGISTRATION')
        ) {
          this.metrics.incrementCounter('freeze_operations_blocked_total');
          throw new ForbiddenException(
            `Tournament operations are frozen for scope: REGISTRATION.`,
          );
        }
      }

      // 2. Guard: tournament must be in REGISTRATION_OPEN status
      if (tournament.status !== 'REGISTRATION_OPEN') {
        throw new BadRequestException(
          `Tournament registrations are not currently open (status: ${tournament.status}).`,
        );
      }

      // 3. Guard: registration window must be active
      const now = new Date();
      this.assertRegistrationWindowOpen(
        tournament.registrationStartsAt,
        tournament.registrationEndsAt,
        now,
      );

      const config = tournament.config as TournamentConfig;
      const maxTeams = config.maxTeams;

      // 4. Count currently active registrations (PENDING + APPROVED)
      const activeCount = await tx.team.count({
        where: {
          tournamentId,
          deletedAt: null,
          status: { in: [TeamStatus.PENDING, TeamStatus.APPROVED] },
        },
      });

      // 5. Determine if we should waitlist
      const isAtCapacity = activeCount >= maxTeams;
      let waitlistPosition: number | null = null;

      if (isAtCapacity) {
        // Atomically compute next waitlist position within the transaction
        const waitlistCount = await tx.team.count({
          where: {
            tournamentId,
            deletedAt: null,
            status: TeamStatus.WAITLISTED,
          },
        });
        waitlistPosition = waitlistCount + 1;
      }

      const teamStatus = isAtCapacity ? TeamStatus.WAITLISTED : TeamStatus.PENDING;

      // 6. Snapshot the registration details at submission time
      const registrationSnapshot = {
        teamName: input.name,
        captainName: input.captainName,
        captainUid: input.captainUid,
        whatsapp: input.whatsapp ?? null,
        playerCount: input.players.length,
        submittedAt: now.toISOString(),
      };

      // 7. Create the team record
      const team = await tx.team.create({
        data: {
          tournamentId,
          name: input.name,
          captainName: input.captainName,
          captainUid: input.captainUid, // locked — immutable
          whatsapp: input.whatsapp,
          status: teamStatus,
          waitlistPosition,
          registrationSnapshot,
        },
      });

      // 8. Create player records (DB unique constraint catches duplicate UIDs)
      await tx.player.createMany({
        data: input.players.map((p) => ({
          teamId: team.id,
          tournamentId,
          gameUid: p.gameUid,
          name: p.name,
          isCaptain: p.isCaptain,
          isSubstitute: p.isSubstitute ?? false,
        })),
      });

      // 9. Emit domain event
      const eventType = isAtCapacity ? 'TeamWaitlisted' : 'TeamRegistered';
      await this.domainEvents.emit(eventType, {
        tournamentId,
        actorId: 'public', // no auth in Phase 2; Phase 3 will pass user id
        data: {
          teamId: team.id,
          teamName: team.name,
          captainName: team.captainName,
          waitlistPosition,
        },
      });

      this.logger.log(
        `[Registration] Team "${team.name}" registered as ${teamStatus} for tournament ${tournamentId}`,
      );

      return {
        teamId: team.id,
        status: teamStatus,
        waitlistPosition,
        message: isAtCapacity
          ? `Tournament is full. You have been waitlisted at position ${waitlistPosition}.`
          : 'Your team has been registered and is pending review.',
      };
    });
  }

  // ── PUBLIC: Edit a PENDING team ───────────────────────────────────────────

  /**
   * Allows editing of team details while status is PENDING.
   *
   * Restrictions:
   *   - Only PENDING teams may be edited (not APPROVED, WAITLISTED, etc.)
   *   - captainUid cannot be changed (locked at submission)
   *   - If players are updated, the same gameUid uniqueness rules apply
   *
   * @throws ConflictException if team is not in PENDING status
   * @throws ForbiddenException if attempting to change captainUid
   */
  async editPendingTeam(
    tournamentId: string,
    teamId: string,
    input: EditPendingTeamInput,
  ) {
    await this.assertTournamentNotFrozen(tournamentId, 'REGISTRATION');
    const team = await this.assertTeamExists(tournamentId, teamId);

    if (team.status !== TeamStatus.PENDING) {
      throw new ConflictException(
        `Only PENDING teams may be edited. Current status: ${team.status}.`,
      );
    }

    // Lock: captain UID is immutable after submission
    // We don't expose captainUid in EditPendingTeamSchema but guard it explicitly
    const updateData: Prisma.TeamUpdateInput = {};
    if (input.name) updateData.name = input.name;
    if (input.whatsapp !== undefined) updateData.whatsapp = input.whatsapp;
    if (input.captainName) updateData.captainName = input.captainName;

    let updatedTeam = await this.prisma.team.update({
      where: { id: teamId },
      data: updateData,
    });

    // Replace players if provided
    if (input.players && input.players.length > 0) {
      // Validate that the captain player still uses the locked captainUid
      const captainPlayer = input.players.find((p) => p.isCaptain);
      if (captainPlayer && captainPlayer.gameUid !== team.captainUid) {
        throw new ForbiddenException(
          `Captain UID is locked (${team.captainUid}) and cannot be changed after submission.`,
        );
      }

      // Delete existing players and recreate
      await this.prisma.$transaction(async (tx) => {
        await tx.player.deleteMany({ where: { teamId } });
        await tx.player.createMany({
          data: input.players!.map((p) => ({
            teamId,
            tournamentId,
            gameUid: p.gameUid,
            name: p.name,
            isCaptain: p.isCaptain,
            isSubstitute: p.isSubstitute ?? false,
          })),
        });
      });
    }

    updatedTeam = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { players: true },
    }) as typeof updatedTeam;

    return updatedTeam;
  }

  // ── PUBLIC: Get team registration status ──────────────────────────────────

  /**
   * Returns the registration status of a team.
   * If WAITLISTED, includes their waitlist position.
   */
  async getTeamStatus(tournamentId: string, teamId: string) {
    const team = await this.assertTeamExists(tournamentId, teamId);

    return {
      teamId: team.id,
      teamName: team.name,
      status: team.status,
      waitlistPosition: team.waitlistPosition ?? null,
      captainName: team.captainName,
      submittedAt: team.createdAt,
    };
  }

  // ── ADMIN: List all teams for a tournament ────────────────────────────────

  async listTeams(
    tournamentId: string,
    query: {
      status?: TeamStatus;
      page?: number;
      limit?: number;
    },
  ) {
    // Ensure tournament exists
    await this.assertTournamentExists(tournamentId);

    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.TeamWhereInput = {
      tournamentId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;

    const [teams, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { waitlistPosition: 'asc' },
          { createdAt: 'asc' },
        ],
        include: {
          players: true,
          _count: { select: { players: true } },
        },
      }),
      this.prisma.team.count({ where }),
    ]);

    return {
      data: teams,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── ADMIN: Approve a team ────────────────────────────────────────────────

  /**
   * Approves a PENDING or WAITLISTED team.
   *
   * Safety: Issues SELECT FOR UPDATE on the Tournament row to prevent
   * concurrent approvals from exceeding maxTeams capacity. This mirrors
   * the same locking strategy used in registerTeam().
   *
   * @throws ConflictException if approval would exceed tournament capacity
   */
  async approveTeam(
    tournamentId: string,
    teamId: string,
    actorId: string,
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Lock the tournament row to serialize concurrent approvals
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          config: unknown;
          operationsFrozen: boolean;
          freezeScopes: any[];
        }>
      >(
        Prisma.sql`
          SELECT id, config, "operationsFrozen", "freezeScopes"
          FROM "Tournament"
          WHERE id = ${tournamentId}
          FOR UPDATE
        `,
      );

      if (rows.length === 0) {
        throw new NotFoundException(`Tournament ${tournamentId} not found.`);
      }

      const tournament = rows[0];
      if (
        tournament.operationsFrozen &&
        (tournament.freezeScopes.includes('ALL') ||
          tournament.freezeScopes.includes('REGISTRATION'))
      ) {
        this.metrics.incrementCounter('freeze_operations_blocked_total');
        throw new ForbiddenException(
          `Tournament operations are frozen for scope: REGISTRATION.`,
        );
      }

      const config = tournament.config as TournamentConfig;

      // 2. Re-read team inside the transaction (never trust pre-lock reads)
      const team = await tx.team.findFirst({
        where: { id: teamId, tournamentId, deletedAt: null },
      });

      if (!team) {
        throw new NotFoundException(`Team ${teamId} not found.`);
      }

      if (team.status === TeamStatus.APPROVED) {
        throw new ConflictException('Team is already approved.');
      }

      if (
        team.status !== TeamStatus.PENDING &&
        team.status !== TeamStatus.WAITLISTED
      ) {
        throw new ConflictException(
          `Cannot approve a team in ${team.status} status.`,
        );
      }

      // 3. Re-check capacity with fresh count (within lock)
      const approvedCount = await tx.team.count({
        where: { tournamentId, deletedAt: null, status: TeamStatus.APPROVED },
      });

      if (approvedCount >= config.maxTeams) {
        throw new ConflictException(
          `Tournament has reached its capacity of ${config.maxTeams} approved teams.`,
        );
      }

      // 4. Approve the team with audit logs
      const updated = await tx.team.update({
        where: { id: teamId },
        data: {
          status: TeamStatus.APPROVED,
          waitlistPosition: null, // no longer on waitlist
          previousStatus: team.status,
          statusChangedBy: actorId,
          statusChangedAt: new Date(),
          statusReason: reason || null,
          statusSource: 'ADMIN',
        },
      });

      // 5. Re-index remaining waitlisted teams to keep positions contiguous
      const remainingWaitlisted = await tx.team.findMany({
        where: {
          tournamentId,
          status: TeamStatus.WAITLISTED,
          deletedAt: null,
        },
        orderBy: [
          { waitlistPosition: 'asc' },
          { createdAt: 'asc' },
        ],
        select: { id: true },
      });

      for (let i = 0; i < remainingWaitlisted.length; i++) {
        await tx.team.update({
          where: { id: remainingWaitlisted[i].id },
          data: { waitlistPosition: i + 1 },
        });
      }

      // 6. Emit domain event
      await this.domainEvents.emit('TeamApproved', {
        tournamentId,
        actorId,
        data: { teamId, teamName: team.name, reason },
      });

      this.logger.log(`[Registration] Team "${team.name}" approved by ${actorId}`);
      return updated;
    });
  }

  // ── ADMIN: Reject a team ─────────────────────────────────────────────────

  async rejectTeam(
    tournamentId: string,
    teamId: string,
    input: RejectTeamInput,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTournamentNotFrozen(tournamentId, 'REGISTRATION', tx);
      const team = await tx.team.findFirst({
        where: { id: teamId, tournamentId, deletedAt: null },
      });

      if (!team) {
        throw new NotFoundException(
          `Team ${teamId} not found in tournament ${tournamentId}.`,
        );
      }

      if (team.status === TeamStatus.APPROVED) {
        throw new ConflictException('Cannot reject an already approved team.');
      }

      if (team.status === TeamStatus.REJECTED) {
        throw new ConflictException('Team is already rejected.');
      }

      const updated = await tx.team.update({
        where: { id: teamId },
        data: {
          status: TeamStatus.REJECTED,
          waitlistPosition: null,
          previousStatus: team.status,
          statusChangedBy: actorId,
          statusChangedAt: new Date(),
          statusReason: input.reason,
          statusSource: 'ADMIN',
        },
      });

      // Re-index remaining waitlisted teams to keep positions contiguous
      const remainingWaitlisted = await tx.team.findMany({
        where: {
          tournamentId,
          status: TeamStatus.WAITLISTED,
          deletedAt: null,
        },
        orderBy: [
          { waitlistPosition: 'asc' },
          { createdAt: 'asc' },
        ],
        select: { id: true },
      });

      for (let i = 0; i < remainingWaitlisted.length; i++) {
        await tx.team.update({
          where: { id: remainingWaitlisted[i].id },
          data: { waitlistPosition: i + 1 },
        });
      }

      await this.domainEvents.emit('TeamRejected', {
        tournamentId,
        actorId,
        data: { teamId, teamName: team.name, reason: input.reason },
      });

      return updated;
    });
  }

  // ── ADMIN: Bulk approve ──────────────────────────────────────────────────

  /**
   * Approves multiple teams in a single database transaction.
   *
   * Safety: Same SELECT FOR UPDATE pattern as approveTeam() — the tournament
   * row is locked once for the entire batch. Capacity is checked before each
   * individual approval to respect maxTeams strictly.
   */
  async bulkApprove(
    tournamentId: string,
    input: BulkApproveInput,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Lock tournament row once for the entire batch
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          config: unknown;
          operationsFrozen: boolean;
          freezeScopes: any[];
        }>
      >(
        Prisma.sql`
          SELECT id, config, "operationsFrozen", "freezeScopes"
          FROM "Tournament"
          WHERE id = ${tournamentId}
          FOR UPDATE
        `,
      );

      if (rows.length === 0) {
        throw new NotFoundException(`Tournament ${tournamentId} not found.`);
      }

      const tournament = rows[0];
      if (
        tournament.operationsFrozen &&
        (tournament.freezeScopes.includes('ALL') ||
          tournament.freezeScopes.includes('REGISTRATION'))
      ) {
        this.metrics.incrementCounter('freeze_operations_blocked_total');
        throw new ForbiddenException(
          `Tournament operations are frozen for scope: REGISTRATION.`,
        );
      }

      const config = tournament.config as TournamentConfig;
      const maxTeams = config.maxTeams;

      const results: Array<{ teamId: string; result: 'approved' | 'skipped'; reason?: string }> = [];

      for (const teamId of input.teamIds) {
        // Re-read capacity inside loop (within the same lock)
        const approvedCount = await tx.team.count({
          where: { tournamentId, deletedAt: null, status: TeamStatus.APPROVED },
        });

        if (approvedCount >= maxTeams) {
          results.push({ teamId, result: 'skipped', reason: 'Capacity reached' });
          continue;
        }

        const team = await tx.team.findFirst({
          where: { id: teamId, tournamentId, deletedAt: null },
        });

        if (!team) {
          results.push({ teamId, result: 'skipped', reason: 'Team not found' });
          continue;
        }

        if (
          team.status !== TeamStatus.PENDING &&
          team.status !== TeamStatus.WAITLISTED
        ) {
          results.push({
            teamId,
            result: 'skipped',
            reason: `Cannot approve team in ${team.status} status`,
          });
          continue;
        }

        await tx.team.update({
          where: { id: teamId },
          data: {
            status: TeamStatus.APPROVED,
            waitlistPosition: null,
            previousStatus: team.status,
            statusChangedBy: actorId,
            statusChangedAt: new Date(),
            statusReason: input.reason || null,
            statusSource: 'ADMIN',
          },
        });

        await this.domainEvents.emit('TeamApproved', {
          tournamentId,
          actorId,
          data: { teamId, teamName: team.name, reason: input.reason },
        });

        results.push({ teamId, result: 'approved' });
      }

      // Re-index remaining waitlisted teams to keep positions contiguous
      const remainingWaitlisted = await tx.team.findMany({
        where: {
          tournamentId,
          status: TeamStatus.WAITLISTED,
          deletedAt: null,
        },
        orderBy: [
          { waitlistPosition: 'asc' },
          { createdAt: 'asc' },
        ],
        select: { id: true },
      });

      for (let i = 0; i < remainingWaitlisted.length; i++) {
        await tx.team.update({
          where: { id: remainingWaitlisted[i].id },
          data: { waitlistPosition: i + 1 },
        });
      }

      const approvedCount = results.filter((r) => r.result === 'approved').length;
      this.logger.log(
        `[Registration] Bulk approve: ${approvedCount}/${input.teamIds.length} teams approved by ${actorId}`,
      );

      return { results };
    });
  }

  // ── ADMIN: Export CSV ────────────────────────────────────────────────────

  /**
   * Exports all non-deleted teams for a tournament as a CSV string.
   * Includes team status, captain info, player count, and waitlist position.
   */
  async exportTeamsCsv(tournamentId: string): Promise<string> {
    await this.assertTournamentExists(tournamentId);

    const teams = await this.prisma.team.findMany({
      where: { tournamentId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { waitlistPosition: 'asc' }, { createdAt: 'asc' }],
      include: {
        players: { orderBy: { isCaptain: 'desc' } },
      },
    });

    const csvRows: string[] = [
      [
        'Team ID',
        'Team Name',
        'Status',
        'Captain Name',
        'Captain UID',
        'WhatsApp',
        'Player Count',
        'Waitlist Position',
        'Registered At',
      ].join(','),
    ];

    for (const team of teams) {
      csvRows.push(
        [
          team.id,
          this.csvEscape(team.name),
          team.status,
          this.csvEscape(team.captainName ?? ''),
          this.csvEscape(team.captainUid ?? ''),
          this.csvEscape(team.whatsapp ?? ''),
          team.players.length,
          team.waitlistPosition ?? '',
          team.createdAt.toISOString(),
        ].join(','),
      );
    }

    return csvRows.join('\n');
  }

  // ── PRIVATE HELPERS ──────────────────────────────────────────────────────

  /**
   * Validates that the registration window is currently open.
   * If neither date is set, registration is open as long as the tournament status
   * is REGISTRATION_OPEN (i.e. window defaults to "always open while published").
   */
  private assertRegistrationWindowOpen(
    startsAt: Date | null,
    endsAt: Date | null,
    now: Date,
  ): void {
    if (startsAt && now < startsAt) {
      throw new ForbiddenException(
        `Registration has not started yet. Opens at ${startsAt.toISOString()}.`,
      );
    }
    if (endsAt && now > endsAt) {
      throw new ForbiddenException(
        `Registration has closed. Closed at ${endsAt.toISOString()}.`,
      );
    }
  }

  private async assertTournamentExists(tournamentId: string) {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
    });
    if (!tournament) {
      throw new NotFoundException(`Tournament ${tournamentId} not found.`);
    }
    return tournament;
  }

  private async assertTeamExists(tournamentId: string, teamId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, tournamentId, deletedAt: null },
      include: { players: true },
    });
    if (!team) {
      throw new NotFoundException(
        `Team ${teamId} not found in tournament ${tournamentId}.`,
      );
    }
    return team;
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
