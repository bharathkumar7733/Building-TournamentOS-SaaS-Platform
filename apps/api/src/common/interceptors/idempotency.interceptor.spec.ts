import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { ExecutionContext, CallHandler, BadRequestException, ConflictException } from '@nestjs/common';
import { of } from 'rxjs';
import * as crypto from 'crypto';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;

  const mockPrismaService = {
    tournament: {
      findFirst: jest.fn(),
    },
    idempotencyKey: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    team: {
      findUnique: jest.fn(),
    },
  };

  const mockRequest = {
    headers: {},
    params: {},
    body: {},
  };

  const mockResponse = {
    statusCode: 200,
    status: jest.fn().mockImplementation((code) => {
      mockResponse.statusCode = code;
      return mockResponse;
    }),
  };

  const mockExecutionContext = {
    switchToHttp: () => ({
      getRequest: () => mockRequest,
      getResponse: () => mockResponse,
    }),
  } as unknown as ExecutionContext;

  const mockCallHandler = {
    handle: jest.fn(),
  } as unknown as CallHandler;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    interceptor = module.get<IdempotencyInterceptor>(IdempotencyInterceptor);

    // Reset request and response
    mockRequest.headers = {};
    mockRequest.params = {};
    mockRequest.body = {};
    mockResponse.statusCode = 200;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should pass through if no x-idempotency-key header is present', async () => {
    mockCallHandler.handle.mockReturnValue(of({ success: true }));

    const result$ = await interceptor.intercept(mockExecutionContext, mockCallHandler);
    const result = await result$.toPromise();

    expect(result).toEqual({ success: true });
    expect(mockPrismaService.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('should throw ConflictException if request with key is already processing', async () => {
    mockRequest.headers['x-idempotency-key'] = 'key-123';
    mockRequest.body = { foo: 'bar' };

    const err = new Error('Prisma error');
    (err as any).code = 'P2002';
    mockPrismaService.idempotencyKey.create.mockRejectedValueOnce(err);

    mockPrismaService.idempotencyKey.findUnique.mockResolvedValueOnce({
      id: 'id-1',
      state: 'PROCESSING',
      requestHash: crypto.createHash('sha256').update(JSON.stringify(mockRequest.body)).digest('hex'),
    });

    await expect(interceptor.intercept(mockExecutionContext, mockCallHandler)).rejects.toThrow(ConflictException);
  });

  it('should throw BadRequestException if payloads do not match on retry of completed request', async () => {
    mockRequest.headers['x-idempotency-key'] = 'key-123';
    mockRequest.body = { foo: 'bar-different' };

    const err = new Error('Prisma error');
    (err as any).code = 'P2002';
    mockPrismaService.idempotencyKey.create.mockRejectedValueOnce(err);

    mockPrismaService.idempotencyKey.findUnique.mockResolvedValueOnce({
      id: 'id-1',
      state: 'COMPLETED',
      requestHash: 'hash-of-original-payload',
    });

    await expect(interceptor.intercept(mockExecutionContext, mockCallHandler)).rejects.toThrow(BadRequestException);
  });

  it('should return cached response if request is already completed', async () => {
    mockRequest.headers['x-idempotency-key'] = 'key-123';
    mockRequest.body = { foo: 'bar' };

    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(mockRequest.body)).digest('hex');

    const err = new Error('Prisma error');
    (err as any).code = 'P2002';
    mockPrismaService.idempotencyKey.create.mockRejectedValueOnce(err);

    mockPrismaService.idempotencyKey.findUnique.mockResolvedValueOnce({
      id: 'id-1',
      state: 'COMPLETED',
      requestHash: bodyHash,
      responseStatus: 200,
      responseBody: { success: true, fromCache: true },
    });

    const result$ = await interceptor.intercept(mockExecutionContext, mockCallHandler);
    const result = await result$.toPromise();

    expect(result).toEqual({ success: true, fromCache: true });
    expect(mockResponse.status).toHaveBeenCalledWith(200);
  });

  it('should fetch the resource reference if body size exceeds 100KB cache threshold', async () => {
    mockRequest.headers['x-idempotency-key'] = 'key-123';
    mockRequest.body = { foo: 'bar' };

    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(mockRequest.body)).digest('hex');

    const err = new Error('Prisma error');
    (err as any).code = 'P2002';
    mockPrismaService.idempotencyKey.create.mockRejectedValueOnce(err);

    mockPrismaService.idempotencyKey.findUnique.mockResolvedValueOnce({
      id: 'id-1',
      state: 'COMPLETED',
      requestHash: bodyHash,
      responseStatus: 201,
      resourceId: 't-123',
      resourceType: 'team',
    });

    mockPrismaService.team.findUnique.mockResolvedValueOnce({
      id: 't-123',
      status: 'APPROVED',
      waitlistPosition: null,
    });

    const result$ = await interceptor.intercept(mockExecutionContext, mockCallHandler);
    const result = await result$.toPromise();

    expect(result.data.teamId).toBe('t-123');
    expect(result.data.status).toBe('APPROVED');
    expect(mockPrismaService.team.findUnique).toHaveBeenCalledWith({ where: { id: 't-123' } });
  });

  it('should cache response directly if body size is <= 100KB', async () => {
    mockRequest.headers['x-idempotency-key'] = 'key-123';
    mockRequest.body = { foo: 'bar' };

    mockPrismaService.idempotencyKey.create.mockResolvedValueOnce({ id: 'id-1' });
    mockCallHandler.handle.mockReturnValue(of({ data: 'small-response' }));

    const result$ = await interceptor.intercept(mockExecutionContext, mockCallHandler);
    const result = await result$.toPromise();

    expect(result).toEqual({ data: 'small-response' });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockPrismaService.idempotencyKey.update).toHaveBeenCalledWith({
      where: { organizationId_key: { organizationId: 'SYSTEM', key: 'key-123' } },
      data: {
        state: 'COMPLETED',
        responseStatus: 200,
        responseBody: { data: 'small-response' },
      },
    });
  });

  it('should save resource ID and Type if response size is > 100KB', async () => {
    mockRequest.headers['x-idempotency-key'] = 'key-123';
    mockRequest.body = { foo: 'bar' };

    mockPrismaService.idempotencyKey.create.mockResolvedValueOnce({ id: 'id-1' });

    const largeData = 'A'.repeat(101 * 1024);
    mockCallHandler.handle.mockReturnValue(of({ teamId: 't-large-123', data: largeData }));

    const result$ = await interceptor.intercept(mockExecutionContext, mockCallHandler);
    await result$.toPromise();

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockPrismaService.idempotencyKey.update).toHaveBeenCalledWith({
      where: { organizationId_key: { organizationId: 'SYSTEM', key: 'key-123' } },
      data: {
        state: 'COMPLETED',
        responseStatus: 200,
        resourceId: 't-large-123',
        resourceType: 'team',
      },
    });
  });
});
