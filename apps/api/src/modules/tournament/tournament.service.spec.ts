import { Test, TestingModule } from '@nestjs/testing';
import { TournamentService } from './tournament.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { TournamentStatus } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DEFAULT_TOURNAMENT_CONFIG } from './types/tournament-config.types';
import { MetricsService } from './services/metrics.service';

describe('TournamentService', () => {
  let service: TournamentService;

  // ── Mock Prisma ────────────────────────────────────────────────────────────

  const mockPrismaService = {
    organization: {
      upsert: jest.fn().mockResolvedValue({ id: 'mock-org-id', name: 'Mock Org', slug: 'mock-org' }),
    },
    tournament: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 't1', status: TournamentStatus.DRAFT, ...data }),
      ),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
    tournamentTemplate: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    domainEvent: {
      create: jest.fn().mockResolvedValue({ id: 'evt1' }),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    stage: { findMany: jest.fn().mockResolvedValue([]) },
    team: { count: jest.fn().mockResolvedValue(0) },
  };

  // ── Mock DomainEventService ────────────────────────────────────────────────

  const mockDomainEventService = {
    emit: jest.fn().mockResolvedValue(undefined),
  };

  // ── Mock MetricsService ────────────────────────────────────────────────────

  const mockMetricsService = {
    incrementCounter: jest.fn(),
    recordHistogram: jest.fn(),
  };

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TournamentService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DomainEventService, useValue: mockDomainEventService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<TournamentService>(TournamentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a tournament in DRAFT status', async () => {
      const input = {
        name: 'Weekly FF Cup',
        game: 'Free Fire',
        startDate: new Date(Date.now() + 86400000).toISOString(),
        config: {
          maxTeams: 64,
          roomCapacity: 20,
          qualificationType: 'TOP_X_PER_ROOM' as const,
          pointTable: DEFAULT_TOURNAMENT_CONFIG.pointTable,
          killPoints: 1,
          tiebreaker: 'kills' as const,
        },
      };

      const result = await service.create('mock-org-id', input, 'mock-admin-id');
      expect(result.status).toBe(TournamentStatus.DRAFT);
      expect(result.name).toBe(input.name);
      expect(mockPrismaService.organization.upsert).toHaveBeenCalled();
      expect(mockPrismaService.tournament.create).toHaveBeenCalled();
      // Fix 5: domain event emitted
      expect(mockDomainEventService.emit).toHaveBeenCalledWith(
        'TournamentCreated',
        expect.objectContaining({ actorId: 'mock-admin-id' }),
      );
    });
  });

  // ── publish ────────────────────────────────────────────────────────────────

  describe('publish', () => {
    it('should require readiness before publishing', async () => {
      // Mock findFirst to return tournament with no stages/rules (will fail checklist)
      mockPrismaService.tournament.findFirst.mockResolvedValueOnce({
        id: 't1',
        organizationId: 'mock-org-id',
        name: 'T',
        startDate: new Date(),
        rules: null,
        status: TournamentStatus.DRAFT,
        stages: [],
        config: DEFAULT_TOURNAMENT_CONFIG,
      });

      await expect(
        service.publish('mock-org-id', 't1', 'mock-admin-id'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if state transition is invalid', async () => {
      // Mock publish readiness as ready, but status is already REGISTRATION_OPEN
      mockPrismaService.tournament.findFirst
        .mockResolvedValueOnce({
          // getPublishReadiness call
          id: 't1',
          organizationId: 'mock-org-id',
          name: 'Test Tournament',
          startDate: new Date(Date.now() + 86400000),
          rules: 'Some rules',
          status: TournamentStatus.REGISTRATION_OPEN,
          stages: [
            {
              id: 's1',
              rounds: [{ rooms: [{ id: 'r1' }] }],
            },
          ],
        })
        .mockResolvedValueOnce({
          // findOne call
          id: 't1',
          organizationId: 'mock-org-id',
          status: TournamentStatus.REGISTRATION_OPEN,
          stages: [],
          _count: { teams: 0 },
        });

      await expect(
        service.publish('mock-org-id', 't1', 'mock-admin-id'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── update: state machine locking (Fix 4) ─────────────────────────────────

  describe('update', () => {
    it('should block locked fields (maxTeams) after REGISTRATION_OPEN', async () => {
      mockPrismaService.tournament.findFirst.mockResolvedValueOnce({
        id: 't1',
        organizationId: 'mock-org-id',
        name: 'T',
        startDate: new Date(Date.now() + 86400000),
        rules: 'rules',
        status: TournamentStatus.REGISTRATION_OPEN,
        stages: [],
        config: DEFAULT_TOURNAMENT_CONFIG,
        deletedAt: null,
        _count: { teams: 0 },
      });

      await expect(
        service.update('mock-org-id', 't1', { config: { maxTeams: 300 } }, 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow non-locked config fields after REGISTRATION_OPEN', async () => {
      mockPrismaService.tournament.findFirst.mockResolvedValueOnce({
        id: 't1',
        organizationId: 'mock-org-id',
        name: 'T',
        startDate: new Date(Date.now() + 86400000),
        rules: 'rules',
        status: TournamentStatus.REGISTRATION_OPEN,
        stages: [],
        config: DEFAULT_TOURNAMENT_CONFIG,
        deletedAt: null,
        _count: { teams: 0 },
      });
      mockPrismaService.tournament.update.mockResolvedValueOnce({
        id: 't1',
        status: TournamentStatus.REGISTRATION_OPEN,
        config: { ...DEFAULT_TOURNAMENT_CONFIG, killPoints: 2 },
      });

      const result = await service.update(
        'mock-org-id',
        't1',
        { config: { killPoints: 2 } },
        'admin',
      );
      expect(result).toBeDefined();
      expect(mockPrismaService.tournament.update).toHaveBeenCalled();
    });
  });
});
