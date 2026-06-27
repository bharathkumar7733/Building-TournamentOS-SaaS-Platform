import { Test, TestingModule } from '@nestjs/testing';
import { RoomMutationPolicy } from './room-mutation.policy';
import { PrismaService } from '../../prisma/prisma.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { MetricsService } from '../services/metrics.service';
import { DomainEventBus } from '../../events/domain-event-bus.service';

describe('RoomMutationPolicy', () => {
  let policy: RoomMutationPolicy;

  const mockPrismaService = {
    room: {
      findFirst: jest.fn(),
    },
    tournament: {
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const mockMetricsService = {
    incrementCounter: jest.fn(),
    recordHistogram: jest.fn(),
  };

  const mockDomainEventBus = {
    emit: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomMutationPolicy,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: DomainEventBus, useValue: mockDomainEventBus },
      ],
    }).compile();

    policy = module.get<RoomMutationPolicy>(RoomMutationPolicy);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw ConflictException if the room does not exist', async () => {
    mockPrismaService.room.findFirst.mockResolvedValueOnce(null);

    await expect(policy.assertRoomMutable('r1')).rejects.toThrow(ConflictException);
  });

  it('should throw ForbiddenException if the room is locked', async () => {
    mockPrismaService.room.findFirst.mockResolvedValueOnce({
      id: 'r1',
      roomNumber: 1,
      isLocked: true,
      capacity: 10,
      round: {
        stage: {
          tournament: {
            operationsFrozen: false,
            freezeScopes: [],
          },
        },
      },
      matches: [],
    });

    await expect(policy.assertRoomMutable('r1')).rejects.toThrow(ForbiddenException);
  });

  it('should throw ConflictException if the room has completed matches', async () => {
    mockPrismaService.room.findFirst.mockResolvedValueOnce({
      id: 'r1',
      roomNumber: 1,
      isLocked: false,
      capacity: 10,
      round: {
        stage: {
          tournament: {
            operationsFrozen: false,
            freezeScopes: [],
          },
        },
      },
      matches: [{ state: 'COMPLETED' }],
    });

    await expect(policy.assertRoomMutable('r1')).rejects.toThrow(ConflictException);
  });

  it('should throw ConflictException if adding teams exceeds capacity', async () => {
    mockPrismaService.room.findFirst.mockResolvedValueOnce({
      id: 'r1',
      roomNumber: 1,
      isLocked: false,
      capacity: 2,
      round: {
        stage: {
          tournament: {
            operationsFrozen: false,
            freezeScopes: [],
          },
        },
      },
      matches: [{ state: 'PENDING' }],
    });

    mockPrismaService.$queryRaw.mockResolvedValueOnce([
      { teamId: 't1' },
      { teamId: 't2' },
    ]);

    await expect(policy.assertRoomMutable('r1', 1)).rejects.toThrow(ConflictException);
  });

  it('should pass successfully if room is unlocked, has no completed matches, and capacity is not exceeded', async () => {
    mockPrismaService.room.findFirst.mockResolvedValueOnce({
      id: 'r1',
      roomNumber: 1,
      isLocked: false,
      capacity: 5,
      round: {
        stage: {
          tournament: {
            operationsFrozen: false,
            freezeScopes: [],
          },
        },
      },
      matches: [{ state: 'PENDING' }],
    });

    mockPrismaService.$queryRaw.mockResolvedValueOnce([
      { teamId: 't1' },
    ]);

    await expect(policy.assertRoomMutable('r1', 2)).resolves.not.toThrow();
  });

  describe('Freeze Mode Guard', () => {
    it('should throw ForbiddenException if room is mutated and tournament is frozen for ROOMS scope', async () => {
      mockPrismaService.room.findFirst.mockResolvedValueOnce({
        id: 'r1',
        roomNumber: 1,
        isLocked: false,
        capacity: 5,
        round: {
          stage: {
            tournament: {
              operationsFrozen: true,
              freezeScopes: ['ROOMS'],
            },
          },
        },
        matches: [],
      });

      await expect(policy.assertRoomMutable('r1')).rejects.toThrow(ForbiddenException);
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('freeze_operations_blocked_total');
    });

    it('should auto-unfreeze and pass if tournament freeze has expired', async () => {
      mockPrismaService.room.findFirst.mockResolvedValueOnce({
        id: 'r1',
        roomNumber: 1,
        isLocked: false,
        capacity: 5,
        round: {
          stage: {
            tournament: {
              id: 't1',
              operationsFrozen: true,
              freezeScopes: ['ROOMS'],
              freezeExpiresAt: new Date(Date.now() - 10000), // expired 10s ago
              freezeVersion: 4,
              frozenAt: new Date(Date.now() - 20000),
            },
          },
        },
        matches: [{ state: 'PENDING' }],
      });

      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        { teamId: 't1' },
      ]);

      mockPrismaService.tournament.update.mockResolvedValueOnce({
        id: 't1',
        operationsFrozen: false,
        freezeVersion: 5,
      });

      await expect(policy.assertRoomMutable('r1', 2)).resolves.not.toThrow();

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

      // Assert metrics and event broadcasts
      expect(mockMetricsService.recordHistogram).toHaveBeenCalledWith('freeze_duration_ms', expect.any(Number));
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('freeze_expired_total');
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith('TournamentFreezeExpired', expect.any(Object));
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith('TournamentStatusChanged', expect.any(Object));
    });
  });
});
