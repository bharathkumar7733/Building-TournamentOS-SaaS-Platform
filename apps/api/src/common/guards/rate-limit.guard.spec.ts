import { Test, TestingModule } from '@nestjs/testing';
import { RateLimiterGuard } from './rate-limit.guard';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../../modules/redis/redis.service';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

describe('RateLimiterGuard', () => {
  let guard: RateLimiterGuard;

  const mockReflector = {
    get: jest.fn(),
  };

  const mockRedisClient = {
    incr: jest.fn(),
    pexpire: jest.fn(),
  };

  const mockRedisService = {
    client: mockRedisClient,
  };

  const mockPrismaService = {
    tournament: {
      findFirst: jest.fn(),
    },
  };

  const mockRequest = {
    headers: {},
    ip: '192.168.1.1',
    route: { path: '/api/v1/tournaments/:tournamentId/register' },
    params: { tournamentId: 't1' },
    body: {},
  };

  const mockExecutionContext = {
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => mockRequest,
    }),
  } as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: RedisService, useValue: mockRedisService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    guard = module.get<RateLimiterGuard>(RateLimiterGuard);

    mockRequest.headers = {};
    mockRequest.ip = '192.168.1.1';
    mockRequest.route = { path: '/api/v1/tournaments/:tournamentId/register' };
    mockRequest.params = { tournamentId: 't1' };
    mockRequest.body = {};
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should allow request if no @RateLimit metadata is defined', async () => {
    mockReflector.get.mockReturnValue(null);

    const result = await guard.canActivate(mockExecutionContext);
    expect(result).toBe(true);
    expect(mockRedisClient.incr).not.toHaveBeenCalled();
  });

  it('should increment rate limit key and set TTL on first request', async () => {
    mockReflector.get.mockReturnValue({ limit: 5, windowMs: 60000 });
    mockPrismaService.tournament.findFirst.mockResolvedValueOnce({ organizationId: 'org-123' });
    mockRedisClient.incr.mockResolvedValueOnce(1);

    const result = await guard.canActivate(mockExecutionContext);

    expect(result).toBe(true);
    const expectedKey = 'rate:org-123:_api_v1_tournaments__tournamentId_register:192.168.1.1';
    expect(mockRedisClient.incr).toHaveBeenCalledWith(expectedKey);
    expect(mockRedisClient.pexpire).toHaveBeenCalledWith(expectedKey, 60000);
  });

  it('should throw HttpException with HttpStatus.TOO_MANY_REQUESTS if limit is exceeded', async () => {
    mockReflector.get.mockReturnValue({ limit: 5, windowMs: 60000 });
    mockPrismaService.tournament.findFirst.mockResolvedValueOnce({ organizationId: 'org-123' });
    mockRedisClient.incr.mockResolvedValueOnce(6);

    await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
      new HttpException('Too many requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS),
    );
  });
});
