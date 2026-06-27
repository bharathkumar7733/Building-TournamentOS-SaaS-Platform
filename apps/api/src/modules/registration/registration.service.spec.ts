import { Test, TestingModule } from '@nestjs/testing';
import { RegistrationService } from './registration.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { DomainEventBus } from '../events/domain-event-bus.service';
import { TeamStatus } from '@prisma/client';
import { ForbiddenException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MetricsService } from '../tournament/services/metrics.service';

describe('RegistrationService', () => {
  let service: RegistrationService;

  // ── Mocks ─────────────────────────────────────────────────────────────────

  const mockPrismaService = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    $queryRaw: jest.fn(),
    team: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    player: {
      createMany: jest.fn(),
    },
    tournament: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockDomainEventService = {
    emit: jest.fn().mockResolvedValue(undefined),
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
        RegistrationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DomainEventService, useValue: mockDomainEventService },
        { provide: DomainEventBus, useValue: mockDomainEventBus },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<RegistrationService>(RegistrationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Register Team ─────────────────────────────────────────────────────────

  describe('registerTeam', () => {
    const validRegistrationInput = {
      name: 'Alpha Team',
      captainName: 'John Doe',
      captainUid: 'uid-captain',
      whatsapp: '+1234567890',
      players: [
        { gameUid: 'uid-captain', name: 'John Doe', isCaptain: true },
        { gameUid: 'uid-p2', name: 'Player 2', isCaptain: false },
        { gameUid: 'uid-p3', name: 'Player 3', isCaptain: false },
        { gameUid: 'uid-p4', name: 'Player 4', isCaptain: false },
      ],
    };

    it('should register a team and mark it as PENDING if tournament has capacity', async () => {
      // Mock tournament query (SELECT FOR UPDATE)
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        {
          id: 't1',
          status: 'REGISTRATION_OPEN',
          config: { maxTeams: 10, roomCapacity: 20 },
          registrationStartsAt: new Date(Date.now() - 3600000), // 1 hour ago
          registrationEndsAt: new Date(Date.now() + 3600000),   // 1 hour from now
        },
      ]);

      // Count of approved + pending teams is 5 (less than maxTeams of 10)
      mockPrismaService.team.count.mockResolvedValueOnce(5);

      mockPrismaService.team.create.mockResolvedValueOnce({
        id: 'team-1',
        name: 'Alpha Team',
        captainName: 'John Doe',
        captainUid: 'uid-captain',
        status: TeamStatus.PENDING,
        waitlistPosition: null,
      });

      const result = await service.registerTeam('t1', validRegistrationInput);

      expect(result.status).toBe(TeamStatus.PENDING);
      expect(result.waitlistPosition).toBeNull();
      expect(mockPrismaService.team.create).toHaveBeenCalled();
      expect(mockPrismaService.player.createMany).toHaveBeenCalled();
      expect(mockDomainEventService.emit).toHaveBeenCalledWith(
        'TeamRegistered',
        expect.any(Object),
      );
    });

    it('should register a team and mark it as WAITLISTED with a position if tournament is at capacity', async () => {
      // Mock tournament query (SELECT FOR UPDATE)
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        {
          id: 't1',
          status: 'REGISTRATION_OPEN',
          config: { maxTeams: 10, roomCapacity: 20 },
          registrationStartsAt: new Date(Date.now() - 3600000),
          registrationEndsAt: new Date(Date.now() + 3600000),
        },
      ]);

      // Active count is 10 (equal to maxTeams capacity)
      mockPrismaService.team.count
        .mockResolvedValueOnce(10) // First call: count active teams
        .mockResolvedValueOnce(2); // Second call: count existing waitlisted teams

      mockPrismaService.team.create.mockResolvedValueOnce({
        id: 'team-waitlist',
        name: 'Alpha Team',
        captainName: 'John Doe',
        captainUid: 'uid-captain',
        status: TeamStatus.WAITLISTED,
        waitlistPosition: 3,
      });

      const result = await service.registerTeam('t1', validRegistrationInput);

      expect(result.status).toBe(TeamStatus.WAITLISTED);
      expect(result.waitlistPosition).toBe(3);
      expect(mockDomainEventService.emit).toHaveBeenCalledWith(
        'TeamWaitlisted',
        expect.any(Object),
      );
    });

    it('should throw ForbiddenException if registration window is not open yet', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        {
          id: 't1',
          status: 'REGISTRATION_OPEN',
          config: { maxTeams: 10, roomCapacity: 20 },
          registrationStartsAt: new Date(Date.now() + 3600000), // starts in 1 hour
          registrationEndsAt: new Date(Date.now() + 7200000),   // ends in 2 hours
        },
      ]);

      await expect(
        service.registerTeam('t1', validRegistrationInput),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should bubble up Prisma database unique constraint errors (duplicate player UID)', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        {
          id: 't1',
          status: 'REGISTRATION_OPEN',
          config: { maxTeams: 10, roomCapacity: 20 },
          registrationStartsAt: new Date(Date.now() - 3600000),
          registrationEndsAt: new Date(Date.now() + 3600000),
        },
      ]);
      mockPrismaService.team.count.mockResolvedValueOnce(0);
      mockPrismaService.team.create.mockResolvedValueOnce({ id: 'team-1' });

      // Mock createMany throwing a unique constraint violation error (P2002)
      const mockPrismaError = new Error('Prisma unique constraint failed');
      (mockPrismaError as any).code = 'P2002';
      mockPrismaService.player.createMany.mockRejectedValueOnce(mockPrismaError);

      await expect(
        service.registerTeam('t1', validRegistrationInput),
      ).rejects.toThrow('Prisma unique constraint failed');
    });
  });

  // ── Waitlist Promotion ────────────────────────────────────────────────────

  describe('waitlist promotion / shifting', () => {
    it('should shift remaining waitlisted teams up when a waitlisted team is approved', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        {
          id: 't1',
          config: { maxTeams: 5 },
        },
      ]);

      // Mock team to approve (which is currently WAITLISTED at position 1)
      mockPrismaService.team.findFirst.mockResolvedValueOnce({
        id: 'team-wait-1',
        name: 'Waitlisted Team 1',
        status: TeamStatus.WAITLISTED,
        waitlistPosition: 1,
      });

      // Approved count is 4 (less than maxTeams of 5)
      mockPrismaService.team.count.mockResolvedValueOnce(4);

      // Mock findMany to return other waitlisted teams remaining
      mockPrismaService.team.findMany.mockResolvedValueOnce([
        { id: 'team-wait-2', waitlistPosition: 2 },
        { id: 'team-wait-3', waitlistPosition: 3 },
      ]);

      mockPrismaService.team.update.mockResolvedValueOnce({
        id: 'team-wait-1',
        status: TeamStatus.APPROVED,
        waitlistPosition: null,
      });

      await service.approveTeam('t1', 'team-wait-1', 'admin-user');

      // Verify shifting calls: team-wait-2 should be updated to position 1, team-wait-3 to position 2
      expect(mockPrismaService.team.update).toHaveBeenCalledWith({
        where: { id: 'team-wait-1' },
        data: {
          status: TeamStatus.APPROVED,
          waitlistPosition: null,
          previousStatus: TeamStatus.WAITLISTED,
          statusChangedAt: expect.any(Date),
          statusChangedBy: 'admin-user',
          statusReason: null,
          statusSource: 'ADMIN',
        },
      });
      expect(mockPrismaService.team.update).toHaveBeenCalledWith({
        where: { id: 'team-wait-2' },
        data: { waitlistPosition: 1 },
      });
      expect(mockPrismaService.team.update).toHaveBeenCalledWith({
        where: { id: 'team-wait-3' },
        data: { waitlistPosition: 2 },
      });
    });
  });

  describe('Freeze Mode Guard', () => {
    it('should throw ForbiddenException on registration if tournament is frozen for REGISTRATION scope', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        {
          id: 't1',
          status: 'REGISTRATION_OPEN',
          config: { maxTeams: 10, roomCapacity: 20 },
          registrationStartsAt: new Date(Date.now() - 3600000),
          registrationEndsAt: new Date(Date.now() + 3600000),
          operationsFrozen: true,
          freezeScopes: ['REGISTRATION'],
        },
      ]);

      await expect(
        service.registerTeam('t1', {
          name: 'Alpha Team',
          captainName: 'John Doe',
          captainUid: 'uid-captain',
          players: [],
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('freeze_operations_blocked_total');
    });

    it('should throw ForbiddenException on approval if tournament is frozen for ALL scope', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        {
          id: 't1',
          config: { maxTeams: 10 },
          operationsFrozen: true,
          freezeScopes: ['ALL'],
        },
      ]);

      await expect(service.approveTeam('t1', 'team-1', 'admin-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('freeze_operations_blocked_total');
    });

    it('should auto-unfreeze and allow registration if tournament freeze has expired', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        {
          id: 't1',
          status: 'REGISTRATION_OPEN',
          config: { maxTeams: 10, roomCapacity: 20 },
          registrationStartsAt: new Date(Date.now() - 3600000),
          registrationEndsAt: new Date(Date.now() + 3600000),
          operationsFrozen: true,
          freezeScopes: ['REGISTRATION'],
          freezeExpiresAt: new Date(Date.now() - 10000),
          freezeVersion: 4,
          frozenAt: new Date(Date.now() - 20000),
        },
      ]);

      mockPrismaService.team.count.mockResolvedValueOnce(5);
      mockPrismaService.team.create.mockResolvedValueOnce({
        id: 'team-1',
        name: 'Alpha Team',
        captainName: 'John Doe',
        captainUid: 'uid-captain',
        status: TeamStatus.PENDING,
        waitlistPosition: null,
      });

      mockPrismaService.tournament.update = jest.fn().mockResolvedValueOnce({
        id: 't1',
        operationsFrozen: false,
        freezeVersion: 5,
      });

      const res = await service.registerTeam('t1', {
        name: 'Alpha Team',
        captainName: 'John Doe',
        captainUid: 'uid-captain',
        players: [],
      });

      expect(res.teamId).toBe('team-1');
      expect(mockPrismaService.tournament.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: {
          operationsFrozen: false,
          freezeVersion: 5,
          freezeEndedAt: expect.any(Date),
          freezeEndReason: 'AUTO_EXPIRED',
        },
      });

      expect(mockMetricsService.recordHistogram).toHaveBeenCalledWith('freeze_duration_ms', expect.any(Number));
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith('freeze_expired_total');
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith('TournamentFreezeExpired', expect.any(Object));
      expect(mockDomainEventBus.emit).toHaveBeenCalledWith('TournamentStatusChanged', expect.any(Object));
    });
  });
});
