import { Test, TestingModule } from '@nestjs/testing';
import { MatchService } from './match.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventBus } from '../../events/domain-event-bus.service';
import { MetricsService } from './metrics.service';
import { MatchState } from '@prisma/client';
import { ConflictException, ForbiddenException } from '@nestjs/common';

describe('MatchService', () => {
  let service: MatchService;

  const mockPrismaService = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    match: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    matchResult: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    matchEvent: {
      create: jest.fn(),
    },
    team: {
      findUnique: jest.fn(),
    },
    tournament: {
      findUnique: jest.fn(),
    },
  };

  const mockDomainEventBus = {
    emit: jest.fn().mockResolvedValue(undefined),
  };

  const mockMetricsService = {
    incrementCounter: jest.fn(),
    recordHistogram: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DomainEventBus, useValue: mockDomainEventBus },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<MatchService>(MatchService);
    
    mockPrismaService.tournament.findUnique.mockResolvedValue({
      operationsFrozen: false,
      freezeScopes: [],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('transitionState', () => {
    it('should transition from UPCOMING to LIVE and record startedAt', async () => {
      const mockMatch = {
        id: 'm1',
        state: MatchState.UPCOMING,
        roomId: 'r1',
        room: { round: { stage: { tournamentId: 't1' } } },
      };

      mockPrismaService.match.findUnique.mockResolvedValueOnce(mockMatch);
      mockPrismaService.match.update.mockResolvedValueOnce({
        ...mockMatch,
        state: MatchState.LIVE,
        startedAt: new Date(),
      });

      const result = await service.transitionState('m1', MatchState.LIVE, 'admin1');

      expect(result.state).toBe(MatchState.LIVE);
      expect(mockPrismaService.match.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: expect.objectContaining({
            state: MatchState.LIVE,
            startedAt: expect.any(Date),
          }),
        }),
      );
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith(
        'MatchStarted',
        expect.objectContaining({
          tournamentId: 't1',
          actorId: 'admin1',
        }),
      );
    });
  });

  describe('updateScore', () => {
    it('should throw ConflictException on version lock mismatch', async () => {
      const mockMatch = {
        id: 'm1',
        state: MatchState.LIVE,
        room: { round: { stage: { tournamentId: 't1', tournament: { config: { pointTable: { '1': 15 }, killPoints: 1 } } } } },
      };

      mockPrismaService.match.findUnique.mockResolvedValueOnce(mockMatch);
      mockPrismaService.matchResult.findUnique.mockResolvedValueOnce({
        matchId: 'm1',
        teamId: 'team1',
        scoreVersion: 2,
      });

      await expect(
        service.updateScore('m1', 'team1', 5, 1, 1, 'admin1'),
      ).rejects.toThrow(ConflictException);

      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('score_conflict_total');
    });

    it('should allow first-time write if client sends version 1', async () => {
      const mockMatch = {
        id: 'm1',
        state: MatchState.LIVE,
        room: { round: { stage: { tournamentId: 't1', tournament: { config: { pointTable: { '1': 15 }, killPoints: 1 } } } } },
      };

      mockPrismaService.match.findUnique.mockResolvedValueOnce(mockMatch);
      mockPrismaService.matchResult.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.matchResult.findFirst.mockResolvedValueOnce(null);
      mockPrismaService.matchResult.upsert.mockResolvedValueOnce({
        matchId: 'm1',
        teamId: 'team1',
        scoreVersion: 1,
      });

      const result = await service.updateScore('m1', 'team1', 5, 1, 1, 'admin1');

      expect(mockPrismaService.matchResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            kills: 5,
            placement: 1,
            scoreVersion: 1,
          }),
        }),
      );
    });

    it('should throw ConflictException on duplicate placement rank', async () => {
      const mockMatch = {
        id: 'm1',
        state: MatchState.LIVE,
        room: { round: { stage: { tournamentId: 't1', tournament: { config: { pointTable: { '1': 15 }, killPoints: 1 } } } } },
      };

      mockPrismaService.match.findUnique.mockResolvedValueOnce(mockMatch);
      mockPrismaService.matchResult.findUnique.mockResolvedValueOnce({
        matchId: 'm1',
        teamId: 'team1',
        scoreVersion: 1,
      });

      mockPrismaService.matchResult.findFirst.mockResolvedValueOnce({
        matchId: 'm1',
        teamId: 'team2',
        placement: 1,
      });

      await expect(
        service.updateScore('m1', 'team1', 5, 1, 1, 'admin1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('revertScore', () => {
    it('should revert team results by updating score values and logging REVERT event', async () => {
      const mockMatch = {
        id: 'm1',
        state: MatchState.LIVE,
        room: { round: { stage: { tournamentId: 't1', tournament: { config: { pointTable: { '1': 15 }, killPoints: 1 } } } } },
      };

      mockPrismaService.match.findUnique.mockResolvedValueOnce(mockMatch);
      mockPrismaService.matchResult.findUnique.mockResolvedValueOnce({
        matchId: 'm1',
        teamId: 'team1',
        kills: 10,
        placement: 1,
        scoreVersion: 2,
      });
      mockPrismaService.matchResult.findFirst.mockResolvedValueOnce(null);
      mockPrismaService.matchResult.update.mockResolvedValueOnce({
        matchId: 'm1',
        teamId: 'team1',
        kills: 5,
        placement: 2,
        scoreVersion: 3,
      });

      const result = await service.revertScore('m1', 'team1', 5, 2, 2, 'admin1');

      expect(result.scoreVersion).toBe(3);
      expect(mockPrismaService.matchResult.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { matchId_teamId: { matchId: 'm1', teamId: 'team1' } },
          data: expect.objectContaining({
            kills: 5,
            placement: 2,
            scoreVersion: 3,
          }),
        }),
      );
      expect(mockPrismaService.matchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'REVERT',
            actorId: 'admin1',
          }),
        }),
      );
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith(
        'ScoreReverted',
        expect.any(Object),
      );
    });
  });

  describe('Freeze Mode Guards', () => {
    it('should throw ForbiddenException if match transition is frozen for MATCH_CONTROL scope', async () => {
      const mockMatch = {
        id: 'm1',
        state: MatchState.UPCOMING,
        roomId: 'r1',
        room: { round: { stage: { tournamentId: 't1', tournament: { id: 't1', config: {} } } } },
      };

      mockPrismaService.match.findUnique.mockResolvedValueOnce(mockMatch);
      mockPrismaService.tournament.findUnique.mockResolvedValueOnce({
        operationsFrozen: true,
        freezeScopes: ['MATCH_CONTROL'],
      });

      await expect(
        service.transitionState('m1', MatchState.LIVE, 'admin1'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('freeze_operations_blocked_total');
    });

    it('should throw ForbiddenException if scoring is frozen for SCORING scope', async () => {
      const mockMatch = {
        id: 'm1',
        state: MatchState.LIVE,
        roomId: 'r1',
        room: { round: { stage: { tournamentId: 't1', tournament: { id: 't1', config: {} } } } },
      };

      mockPrismaService.match.findUnique.mockResolvedValueOnce(mockMatch);
      mockPrismaService.tournament.findUnique.mockResolvedValueOnce({
        operationsFrozen: true,
        freezeScopes: ['SCORING'],
      });

      await expect(
        service.updateScore('m1', 'team1', 5, 2, 1, 'admin1'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('freeze_operations_blocked_total');
    });

    it('should auto-unfreeze and allow transitions/scoring if tournament freeze has expired', async () => {
      const mockMatch = {
        id: 'm1',
        state: MatchState.UPCOMING,
        roomId: 'r1',
        room: { round: { stage: { tournamentId: 't1', tournament: { id: 't1', config: {} } } } },
      };

      mockPrismaService.match.findUnique.mockResolvedValueOnce(mockMatch);
      mockPrismaService.tournament.findUnique.mockResolvedValueOnce({
        id: 't1',
        operationsFrozen: true,
        freezeScopes: ['MATCH_CONTROL'],
        freezeExpiresAt: new Date(Date.now() - 10000), // expired 10s ago
        freezeVersion: 4,
        frozenAt: new Date(Date.now() - 20000),
      });

      mockPrismaService.tournament.update = jest.fn().mockResolvedValueOnce({
        id: 't1',
        operationsFrozen: false,
        freezeVersion: 5,
      });

      mockPrismaService.match.update.mockResolvedValueOnce({
        ...mockMatch,
        state: MatchState.LIVE,
      });

      await service.transitionState('m1', MatchState.LIVE, 'admin1');

      // Assert inline unfreeze update was executed
      expect(mockPrismaService.tournament.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: {
          operationsFrozen: false,
          freezeVersion: 5,
          freezeEndedAt: expect.any(Date),
          freezeEndReason: 'AUTO_EXPIRED',
        },
      });

      // Assert expired metrics & events are triggered
      expect(mockMetricsService.recordHistogram).toHaveBeenCalledWith('freeze_duration_ms', expect.any(Number));
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('freeze_expired_total');
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith('TournamentFreezeExpired', expect.any(Object));
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith('TournamentStatusChanged', expect.any(Object));
    });
  });
});
