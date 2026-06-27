import { Test, TestingModule } from '@nestjs/testing';
import { StandingsWorkerService } from './standings-worker.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventBus } from '../../events/domain-event-bus.service';
import { MetricsService } from './metrics.service';
import { MatchState } from '@prisma/client';

describe('StandingsWorkerService', () => {
  let service: StandingsWorkerService;

  const mockPrismaService = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    standingsRecomputeJob: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    roomStandingSnapshot: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    stageStandingSnapshot: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    room: {
      findUnique: jest.fn(),
    },
    team: {
      findMany: jest.fn(),
    },
    match: {
      findMany: jest.fn(),
    },
    stage: {
      findUnique: jest.fn(),
    },
    matchResult: {
      findMany: jest.fn(),
    },
    tournament: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    standingsDeadLetter: {
      create: jest.fn(),
    },
  };

  const mockDomainEventBus = {
    emit: jest.fn().mockResolvedValue(undefined),
  };

  const mockMetricsService = {
    recordHistogram: jest.fn(),
    incrementCounter: jest.fn(),
    setGauge: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StandingsWorkerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DomainEventBus, useValue: mockDomainEventBus },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<StandingsWorkerService>(StandingsWorkerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Distributed Leasing / Concurrency', () => {
    it('should claim a job successfully when updateMany returns count: 1', async () => {
      const mockJob = {
        id: 'job-1',
        scope: 'ROOM',
        scopeId: 'room-1',
        status: 'PENDING',
        createdAt: new Date(),
        nextAttemptAt: null,
        retryCount: 0,
      };

      mockPrismaService.standingsRecomputeJob.findFirst
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(null);

      mockPrismaService.standingsRecomputeJob.updateMany.mockResolvedValueOnce({ count: 1 });

      mockPrismaService.standingsRecomputeJob.findUnique.mockResolvedValueOnce({
        ...mockJob,
        status: 'PROCESSING',
      });
      
      mockPrismaService.room.findUnique.mockResolvedValueOnce({
        id: 'room-1',
        round: {
          stage: {
            tournament: {
              id: 't-1',
              config: {},
            },
          },
        },
      });
      mockPrismaService.team.findMany.mockResolvedValueOnce([]);
      mockPrismaService.match.findMany.mockResolvedValueOnce([]);
      mockPrismaService.roomStandingSnapshot.findFirst.mockResolvedValueOnce(null);

      await service.processQueue();

      expect(mockPrismaService.standingsRecomputeJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'job-1',
          }),
          data: expect.objectContaining({
            status: 'PROCESSING',
            workerId: expect.any(String),
            leasedUntil: expect.any(Date),
          }),
        }),
      );
      expect(mockPrismaService.standingsRecomputeJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1' },
          data: expect.objectContaining({
            status: 'COMPLETED',
          }),
        }),
      );
    });

    it('should skip job execution if another worker claims it (updateMany returns count: 0)', async () => {
      const mockJob = {
        id: 'job-1',
        scope: 'ROOM',
        scopeId: 'room-1',
        status: 'PENDING',
        createdAt: new Date(),
        nextAttemptAt: null,
      };

      mockPrismaService.standingsRecomputeJob.findFirst
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(null);

      mockPrismaService.standingsRecomputeJob.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.processQueue();

      expect(mockPrismaService.standingsRecomputeJob.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.standingsRecomputeJob.update).not.toHaveBeenCalled();
    });
  });

  describe('Snapshot Activation Safety', () => {
    it('should deactivate older snapshots and activate new snapshot in a transaction for ROOM scope', async () => {
      const mockRoom = {
        id: 'room-1',
        round: {
          stage: {
            tournament: {
              id: 't-1',
              config: {
                pointTable: { '1': 10 },
                killPoints: 1,
              },
            },
          },
        },
      };

      const mockTeams = [{ id: 'team-1', name: 'Team One' }];
      const mockMatches = [
        {
          id: 'm-1',
          roomId: 'room-1',
          state: MatchState.COMPLETED,
          results: [{ teamId: 'team-1', kills: 2, placement: 1 }],
        },
      ];

      mockPrismaService.room.findUnique.mockResolvedValueOnce(mockRoom);
      mockPrismaService.team.findMany.mockResolvedValueOnce(mockTeams);
      mockPrismaService.match.findMany.mockResolvedValueOnce(mockMatches);
      
      mockPrismaService.roomStandingSnapshot.findFirst.mockResolvedValueOnce({
        id: 'snap-old',
        roomId: 'room-1',
        version: 2,
        active: true,
      });

      mockPrismaService.standingsRecomputeJob.findUnique.mockResolvedValueOnce({
        id: 'job-1',
        scope: 'ROOM',
        scopeId: 'room-1',
        status: 'PROCESSING',
      });

      mockPrismaService.standingsRecomputeJob.findFirst
        .mockResolvedValueOnce({ id: 'job-1', scope: 'ROOM', scopeId: 'room-1', status: 'PENDING' })
        .mockResolvedValueOnce(null);
      mockPrismaService.standingsRecomputeJob.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.processQueue();

      expect(mockPrismaService.roomStandingSnapshot.updateMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1', active: true },
        data: { active: false },
      });

      expect(mockPrismaService.roomStandingSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          roomId: 'room-1',
          version: 3,
          active: true,
          standings: expect.any(Array),
        }),
      });
    });
  });

  describe('Worker Retry, Backoff with Jitter, and DLQ', () => {
    it('should calculate exponential backoff with jitter and retry when retryCount < 3', async () => {
      const mockJob = {
        id: 'job-failed',
        scope: 'ROOM',
        scopeId: 'room-1',
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(),
        nextAttemptAt: null,
      };

      mockPrismaService.standingsRecomputeJob.findFirst
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(null);
      mockPrismaService.standingsRecomputeJob.updateMany.mockResolvedValueOnce({ count: 1 });

      mockPrismaService.standingsRecomputeJob.findUnique.mockResolvedValueOnce({
        ...mockJob,
        status: 'PROCESSING',
      });

      mockPrismaService.room.findUnique.mockRejectedValueOnce(new Error('DB connection drop'));

      mockPrismaService.standingsRecomputeJob.findUnique.mockResolvedValueOnce({
        ...mockJob,
        status: 'PROCESSING',
        retryCount: 0,
      });

      const beforeTime = Date.now();
      await service.processQueue();

      // Assert it retried and calculated nextAttemptAt
      expect(mockPrismaService.standingsRecomputeJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-failed' },
          data: expect.objectContaining({
            status: 'PENDING',
            retryCount: 1,
            lastFailure: 'DB connection drop',
            nextAttemptAt: expect.any(Date),
            workerId: null,
            leasedUntil: null,
          }),
        }),
      );

      // Verify that jitter delay bounds for retry 1 (5s base +/- 2s jitter = [3s, 7s]) are honored
      const updateCall = mockPrismaService.standingsRecomputeJob.update.mock.calls[0][0];
      const nextAttemptAt = updateCall.data.nextAttemptAt.getTime();
      const delayMs = nextAttemptAt - beforeTime;
      expect(delayMs).toBeGreaterThanOrEqual(3000 - 500); // 500ms allowance for timer/exec overhead
      expect(delayMs).toBeLessThanOrEqual(7000 + 500);
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('worker_retry_total');
    });

    it('should set status to FAILED and route to DLQ when retryCount exceeds 3', async () => {
      const mockJob = {
        id: 'job-failed-final',
        scope: 'ROOM',
        scopeId: 'room-1',
        status: 'PENDING',
        retryCount: 3,
        createdAt: new Date(),
        nextAttemptAt: null,
      };

      mockPrismaService.standingsRecomputeJob.findFirst
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(null);
      mockPrismaService.standingsRecomputeJob.updateMany.mockResolvedValueOnce({ count: 1 });

      mockPrismaService.standingsRecomputeJob.findUnique.mockResolvedValueOnce({
        ...mockJob,
        status: 'PROCESSING',
      });

      mockPrismaService.room.findUnique.mockRejectedValueOnce(new Error('Scoring engine crash'));

      mockPrismaService.standingsRecomputeJob.findUnique.mockResolvedValueOnce({
        ...mockJob,
        status: 'PROCESSING',
        retryCount: 3,
      });

      await service.processQueue();

      // Assert job status updated to FAILED
      expect(mockPrismaService.standingsRecomputeJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-failed-final' },
          data: expect.objectContaining({
            status: 'FAILED',
            retryCount: 4,
            lastFailure: 'Scoring engine crash',
          }),
        }),
      );

      // Assert copied to Dead Letter Queue (DLQ)
      expect(mockPrismaService.standingsDeadLetter.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jobId: 'job-failed-final',
          reason: 'Scoring engine crash',
          payload: expect.objectContaining({
            scope: 'ROOM',
            scopeId: 'room-1',
            retryCount: 4,
          }),
        }),
      });
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('worker_lease_expired_total');
    });
  });

  describe('Background Freeze Expiry Check', () => {
    it('should auto-unfreeze expired tournaments and preserve audit trail metadata', async () => {
      const mockTournament = {
        id: 't-expired',
        operationsFrozen: true,
        freezeVersion: 4,
        frozenAt: new Date(Date.now() - 10000), // frozen 10s ago
        freezeExpiresAt: new Date(Date.now() - 5000), // expired 5s ago
        frozenBy: 'admin-1',
        freezeReason: 'Score dispute',
        freezeScopes: ['SCORING'],
      };

      mockPrismaService.tournament.findMany.mockResolvedValueOnce([mockTournament]);
      mockPrismaService.tournament.findUnique.mockResolvedValueOnce(mockTournament);
      mockPrismaService.tournament.update.mockResolvedValueOnce({
        ...mockTournament,
        operationsFrozen: false,
        freezeVersion: 5,
        freezeEndedAt: new Date(),
        freezeEndReason: 'AUTO_EXPIRED',
      });

      await service.checkExpiredFreezes();

      // Verify unfreeze update preserves original frozen metadata and records ended state
      expect(mockPrismaService.tournament.update).toHaveBeenCalledWith({
        where: { id: 't-expired' },
        data: {
          operationsFrozen: false,
          freezeVersion: 5,
          freezeEndedAt: expect.any(Date),
          freezeEndReason: 'AUTO_EXPIRED',
        },
      });

      // Verify metrics & audit events
      expect(mockMetricsService.recordHistogram).toHaveBeenCalledWith('freeze_duration_ms', expect.any(Number));
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('freeze_expired_total');
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith('TournamentFreezeExpired', expect.any(Object));
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith('TournamentStatusChanged', expect.any(Object));
    });
  });
});
