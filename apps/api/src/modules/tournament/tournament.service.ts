import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { MetricsService } from './services/metrics.service';
import {
  CreateTournamentInput,
  UpdateTournamentInput,
  LOCKED_CONFIG_KEYS,
} from './dto/tournament.validator';
import {
  TournamentStatus,
  Tournament,
  Prisma,
  FreezeScope,
} from '@prisma/client';
import {
  TournamentConfig,
  DEFAULT_TOURNAMENT_CONFIG,
  PublishReadiness,
} from './types/tournament-config.types';

/** Allowed state transitions (state machine) */
const STATUS_TRANSITIONS: Partial<Record<TournamentStatus, TournamentStatus[]>> =
  {
    [TournamentStatus.DRAFT]: [TournamentStatus.REGISTRATION_OPEN, TournamentStatus.CANCELLED],
    [TournamentStatus.REGISTRATION_OPEN]: [
      TournamentStatus.REGISTRATION_CLOSED,
      TournamentStatus.CANCELLED,
    ],
    [TournamentStatus.REGISTRATION_CLOSED]: [
      TournamentStatus.IN_PROGRESS,
      TournamentStatus.CANCELLED,
    ],
    [TournamentStatus.IN_PROGRESS]: [TournamentStatus.COMPLETED, TournamentStatus.CANCELLED],
    [TournamentStatus.COMPLETED]: [],
    [TournamentStatus.CANCELLED]: [],
  };

/** Statuses after which certain config keys become immutable */
const LOCKED_AFTER_STATUS = new Set<TournamentStatus>([
  TournamentStatus.REGISTRATION_OPEN,
  TournamentStatus.REGISTRATION_CLOSED,
  TournamentStatus.IN_PROGRESS,
  TournamentStatus.COMPLETED,
]);

@Injectable()
export class TournamentService {
  private readonly logger = new Logger(TournamentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEvents: DomainEventService,
    private readonly metrics: MetricsService,
  ) {}

  // ── CREATE ────────────────────────────────────────────────────────────────

  async create(
    orgId: string,
    input: CreateTournamentInput,
    creatorId: string,
  ): Promise<Tournament> {
    // Self-bootstrap organization for Phase 1 dev/testing
    await this.prisma.organization.upsert({
      where: { id: orgId },
      update: {},
      create: { id: orgId, name: 'Mock Organization', slug: orgId },
    });

    const config: TournamentConfig = {
      ...DEFAULT_TOURNAMENT_CONFIG,
      ...(input.config ?? {}),
    };

    const tournament = await this.prisma.tournament.create({
      data: {
        organizationId: orgId,
        name: input.name,
        game: input.game,
        startDate: new Date(input.startDate),
        rules: input.rules,
        config: config as unknown as Prisma.InputJsonValue,
        createdBy: creatorId,
        status: TournamentStatus.DRAFT,
        templateId: input.templateId ?? null,
        registrationStartsAt: input.registrationStartsAt
          ? new Date(input.registrationStartsAt)
          : null,
        registrationEndsAt: input.registrationEndsAt
          ? new Date(input.registrationEndsAt)
          : null,
      },
    });

    // Emit domain event (outbox write)
    await this.domainEvents.emit('TournamentCreated', {
      tournamentId: tournament.id,
      actorId: creatorId,
      data: {
        name: tournament.name,
        game: tournament.game,
        organizationId: orgId,
      },
    });

    // If templateId provided, apply stage template
    if (input.templateId) {
      await this.applyTemplate(tournament.id, input.templateId, config);
    }

    return tournament;
  }

  // ── LIST ──────────────────────────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: {
      page?: number;
      limit?: number;
      status?: TournamentStatus;
      search?: string;
    },
  ) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 10, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.TournamentWhereInput = {
      organizationId: orgId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.tournament.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              teams: { where: { deletedAt: null } },
              stages: { where: { deletedAt: null } },
            },
          },
        },
      }),
      this.prisma.tournament.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── FIND ONE ──────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string): Promise<Tournament> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        stages: {
          where: { deletedAt: null },
          orderBy: { order: 'asc' },
          include: {
            rounds: {
              include: {
                rooms: { where: { deletedAt: null } },
              },
            },
          },
        },
        _count: {
          select: {
            teams: { where: { deletedAt: null, status: 'APPROVED' } },
          },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException(`Tournament with ID ${id} not found.`);
    }

    return tournament as Tournament;
  }

  // ── UPDATE ────────────────────────────────────────────────────────────────

  /**
   * Update is always allowed in DRAFT.
   * Certain config keys are locked once REGISTRATION_OPEN or later.
   * Phase 2: Also updates registrationStartsAt / registrationEndsAt.
   * Phase 2: Records deletedBy when soft-deleting.
   */
  async update(
    orgId: string,
    id: string,
    input: UpdateTournamentInput,
    actorId: string,
  ): Promise<Tournament> {
    const tournament = await this.findOne(orgId, id);

    const isLocked = LOCKED_AFTER_STATUS.has(tournament.status);

    // Prevent any structural update after IN_PROGRESS/COMPLETED
    if (
      tournament.status === TournamentStatus.IN_PROGRESS ||
      tournament.status === TournamentStatus.COMPLETED ||
      tournament.status === TournamentStatus.CANCELLED
    ) {
      throw new ConflictException(
        `Tournament is in ${tournament.status} state and cannot be modified.`,
      );
    }

    // Check locked config keys
    if (isLocked && input.config) {
      const violations = LOCKED_CONFIG_KEYS.filter(
        (key) => key in (input.config ?? {}),
      );

      if (violations.length > 0) {
        throw new ConflictException(
          `Cannot modify [${violations.join(', ')}] after registration has opened.`,
        );
      }
    }

    const currentConfig = tournament.config as unknown as TournamentConfig;
    const updatedConfig: TournamentConfig = {
      ...currentConfig,
      ...(input.config ?? {}),
    };

    const updateData: Prisma.TournamentUpdateInput = {
      config: updatedConfig as unknown as Prisma.InputJsonValue,
    };

    if (input.name) updateData.name = input.name;
    if (input.game) updateData.game = input.game;
    if (input.startDate) updateData.startDate = new Date(input.startDate);
    if (input.rules !== undefined) updateData.rules = input.rules;

    // Phase 2: Update registration window
    if (input.registrationStartsAt !== undefined) {
      updateData.registrationStartsAt = input.registrationStartsAt
        ? new Date(input.registrationStartsAt)
        : null;
    }
    if (input.registrationEndsAt !== undefined) {
      updateData.registrationEndsAt = input.registrationEndsAt
        ? new Date(input.registrationEndsAt)
        : null;
    }

    void actorId; // will be used for audit log in future auth phase

    return this.prisma.tournament.update({
      where: { id },
      data: updateData,
    });
  }

  // ── PUBLISH CHECKLIST ─────────────────────────────────────────────────────

  /**
   * Phase 2 enhanced publish checklist.
   * Added checks: startDateInFuture, registrationWindowValid.
   */
  async getPublishReadiness(orgId: string, id: string): Promise<PublishReadiness> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        stages: {
          where: { deletedAt: null },
          include: {
            rounds: {
              include: { rooms: { where: { deletedAt: null } } },
            },
          },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException(`Tournament with ID ${id} not found.`);
    }

    const now = new Date();
    const hasName = tournament.name.trim().length >= 3;
    const hasStartDate = !!tournament.startDate;
    const hasRules = !!tournament.rules && tournament.rules.trim().length > 0;
    const hasStages = tournament.stages.length > 0;
    const startDateInFuture = !!tournament.startDate && tournament.startDate > now;

    const stagesHaveRooms = hasStages
      ? tournament.stages.every((stage) =>
          stage.rounds.some((round) => round.rooms.length > 0),
        )
      : false;

    // Phase 2: Validate registration window if it has been configured.
    // If no window set, it defaults to "open immediately on publish" (valid).
    let registrationWindowValid = true;
    if (tournament.registrationStartsAt || tournament.registrationEndsAt) {
      const startsAt = tournament.registrationStartsAt;
      const endsAt = tournament.registrationEndsAt;
      registrationWindowValid =
        !!startsAt &&
        !!endsAt &&
        startsAt < endsAt &&
        endsAt <= tournament.startDate;
    }

    const blockers: string[] = [];
    if (!hasName) blockers.push('Tournament name must be at least 3 characters.');
    if (!hasStartDate) blockers.push('A start date is required.');
    if (!startDateInFuture) blockers.push('Start date must be in the future.');
    if (!hasRules) blockers.push('Tournament rules must be provided.');
    if (!hasStages) blockers.push('At least one stage must be created.');
    if (!stagesHaveRooms) blockers.push('All stages must have at least one room.');
    if (!registrationWindowValid)
      blockers.push(
        'Registration window is invalid: ensure startsAt < endsAt ≤ startDate.',
      );

    return {
      hasName,
      hasStartDate,
      hasRules,
      hasStages,
      stagesHaveRooms,
      startDateInFuture,
      registrationWindowValid,
      ready: blockers.length === 0,
      blockers,
    };
  }

  // ── STATUS TRANSITIONS ─────────────────────────────────────────────────────

  /**
   * Gated publish — runs readiness checklist before allowing transition.
   * Emits TournamentPublished domain event.
   */
  async publish(orgId: string, id: string, actorId: string): Promise<Tournament> {
    const readiness = await this.getPublishReadiness(orgId, id);

    if (!readiness.ready) {
      throw new BadRequestException({
        message: 'Tournament is not ready to be published.',
        code: 'PUBLISH_BLOCKED',
        details: readiness.blockers,
      });
    }

    const tournament = await this.findOne(orgId, id);
    this.assertTransition(tournament.status, TournamentStatus.REGISTRATION_OPEN);

    const updated = await this.prisma.tournament.update({
      where: { id },
      data: { status: TournamentStatus.REGISTRATION_OPEN },
    });

    await this.domainEvents.emit('TournamentPublished', {
      tournamentId: id,
      actorId,
      data: {
        name: tournament.name,
        startDate: tournament.startDate.toISOString(),
      },
    });

    return updated;
  }

  async transitionStatus(
    orgId: string,
    id: string,
    toStatus: TournamentStatus,
    actorId: string,
  ): Promise<Tournament> {
    const tournament = await this.findOne(orgId, id);
    this.assertTransition(tournament.status, toStatus);

    const updated = await this.prisma.tournament.update({
      where: { id },
      data: { status: toStatus },
    });

    await this.domainEvents.emit('TournamentStatusChanged', {
      tournamentId: id,
      actorId,
      data: { from: tournament.status, to: toStatus },
    });

    return updated;
  }

  // ── SOFT DELETE ────────────────────────────────────────────────────────────

  /**
   * Phase 2: Records actorId into deletedBy for audit trail.
   */
  async softDelete(orgId: string, id: string, actorId: string): Promise<{ deleted: true }> {
    const tournament = await this.findOne(orgId, id);

    if (
      tournament.status === TournamentStatus.IN_PROGRESS ||
      tournament.status === TournamentStatus.COMPLETED
    ) {
      throw new ConflictException(
        'Cannot delete a tournament that is IN_PROGRESS or COMPLETED.',
      );
    }

    await this.prisma.tournament.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: actorId,
      },
    });

    await this.domainEvents.emit('TournamentDeleted', {
      tournamentId: id,
      actorId,
      data: { name: tournament.name },
    });

    return { deleted: true };
  }

  // ── DASHBOARD METRICS (/metrics/overview) ──────────────────────────────────

  /**
   * Phase 2: Returns real aggregate metrics for the org dashboard.
   * Endpoint renamed to /metrics/overview (see controller).
   */
  async getDashboardMetrics(orgId: string) {
    const [total, live, registrationOpen, teamCount] = await Promise.all([
      this.prisma.tournament.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this.prisma.tournament.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: TournamentStatus.IN_PROGRESS,
        },
      }),
      this.prisma.tournament.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: TournamentStatus.REGISTRATION_OPEN,
        },
      }),
      this.prisma.team.count({
        where: {
          deletedAt: null,
          tournament: { organizationId: orgId, deletedAt: null },
        },
      }),
    ]);

    return {
      totalTournaments: total,
      liveTournaments: live,
      openRegistrations: registrationOpen,
      totalTeams: teamCount,
    };
  }

  // ── TEMPLATE APPLICATION ───────────────────────────────────────────────────

  /**
   * Reads the template's stageBlueprint and creates Stages → Rounds
   * for the new tournament automatically.
   */
  private async applyTemplate(
    tournamentId: string,
    templateId: string,
    config: TournamentConfig,
  ): Promise<void> {
    const template = await this.prisma.tournamentTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) return;

    type StageBlueprintItem = {
      name: string;
      order: number;
      roundCount: number;
      roomCapacity?: number;
      qualificationRule?: object;
    };

    const blueprints = template.stageBlueprint as StageBlueprintItem[];

    for (const bp of blueprints) {
      const stage = await this.prisma.stage.create({
        data: {
          tournamentId,
          name: bp.name,
          order: bp.order,
          qualificationRule: (bp.qualificationRule ?? null) as Prisma.InputJsonValue,
        },
      });

      for (let r = 1; r <= (bp.roundCount ?? 1); r++) {
        const round = await this.prisma.round.create({
          data: { stageId: stage.id, roundNumber: r },
        });

        const capacity = bp.roomCapacity ?? config.roomCapacity;
        const roomCount = Math.ceil(config.maxTeams / capacity);

        await this.prisma.room.createMany({
          data: Array.from({ length: roomCount }, (_, i) => ({
            roundId: round.id,
            roomNumber: i + 1,
            capacity,
          })),
        });
      }
    }
  }

  async toggleFreeze(
    orgId: string,
    id: string,
    freeze: boolean,
    expectedVersion: number,
    actorId: string,
    reason?: string,
    scopes: FreezeScope[] = [],
    freezeExpiresAt?: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
      });

      if (!tournament) {
        throw new NotFoundException(`Tournament ${id} not found.`);
      }

      if (tournament.freezeVersion !== expectedVersion) {
        throw new ConflictException(
          `Freeze Version Conflict: Expected version ${expectedVersion}, but current version is ${tournament.freezeVersion}.`,
        );
      }

      const now = new Date();
      const updatedData: Prisma.TournamentUpdateInput = {
        operationsFrozen: freeze,
        freezeVersion: tournament.freezeVersion + 1,
      };

      if (freeze) {
        updatedData.frozenBy = actorId;
        updatedData.frozenAt = now;
        updatedData.freezeReason = reason;
        updatedData.freezeScopes = scopes;
        updatedData.freezeExpiresAt = freezeExpiresAt || null;
        updatedData.freezeEndedAt = null;
        updatedData.freezeEndReason = null;
      } else {
        updatedData.freezeEndedAt = now;
        updatedData.freezeEndReason = 'MANUAL_UNFREEZE';
      }

      const updated = await tx.tournament.update({
        where: { id },
        data: updatedData,
      });

      // Track metrics & emit domain-specific audit events
      if (freeze) {
        this.metrics.incrementCounter('freeze_active_total');
        await this.domainEvents.emit('TournamentFrozen', {
          tournamentId: id,
          actorId,
          data: {
            reason,
            scopes,
            expiresAt: freezeExpiresAt ? freezeExpiresAt.toISOString() : null,
            freezeVersion: updated.freezeVersion,
          },
        });
      } else {
        const durationMs = tournament.frozenAt ? now.getTime() - new Date(tournament.frozenAt).getTime() : 0;
        if (durationMs > 0) {
          this.metrics.recordHistogram('freeze_duration_ms', durationMs);
        }
        this.metrics.incrementCounter('freeze_manual_unfreeze_total');
        await this.domainEvents.emit('TournamentUnfrozen', {
          tournamentId: id,
          actorId,
          data: {
            reason: 'manual',
            freezeVersion: updated.freezeVersion,
          },
        });
      }

      await this.domainEvents.emit('TournamentStatusChanged', {
        tournamentId: id,
        actorId,
        data: {
          from: `FROZEN:${tournament.operationsFrozen}_v${tournament.freezeVersion}`,
          to: `FROZEN:${freeze}_v${updated.freezeVersion}`,
        },
      });

      return updated;
    });
  }

  /**
   * Replay a failed job from the Dead Letter Queue.
   */
  async replayDeadLetter(orgId: string, tournamentId: string, deadLetterId: string) {
    return this.prisma.$transaction(async (tx) => {
      const dl = await tx.standingsDeadLetter.findUnique({
        where: { id: deadLetterId },
      });

      if (!dl) {
        throw new NotFoundException(`Dead Letter record ${deadLetterId} not found.`);
      }

      const payload = dl.payload as any;
      const scope = payload.scope as 'ROOM' | 'STAGE';
      const scopeId = payload.scopeId;

      // Re-enqueue as a new job
      const job = await tx.standingsRecomputeJob.create({
        data: {
          scope,
          scopeId,
          status: 'PENDING',
        },
      });

      // Remove from DLQ
      await tx.standingsDeadLetter.delete({
        where: { id: deadLetterId },
      });

      this.logger.log(`Replayed DLQ record ${deadLetterId}. Re-enqueued job ${job.id} for ${scope} ${scopeId}.`);
      return job;
    });
  }

  // ── PRIVATE HELPERS ────────────────────────────────────────────────────────

  private assertTransition(
    current: TournamentStatus,
    next: TournamentStatus,
  ): void {
    const allowed = STATUS_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new ConflictException(
        `Cannot transition from ${current} to ${next}.`,
      );
    }
  }
}
