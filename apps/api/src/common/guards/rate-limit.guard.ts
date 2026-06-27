import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../../modules/redis/redis.service';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RATE_LIMIT_METADATA_KEY, RateLimitConfig } from './rate-limit.decorator';
import { Request } from 'express';

@Injectable()
export class RateLimiterGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_METADATA_KEY,
      context.getHandler(),
    );

    // If route doesn't require rate limiting, bypass
    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    
    // Resolve Client IP address
    const ip = (request.headers['x-forwarded-for'] as string) || request.ip || '127.0.0.1';
    
    // Resolve Route Path name
    const route = request.route?.path ? request.route.path.replace(/[^a-zA-Z0-9]/g, '_') : 'route';

    // Resolve Organization ID scope
    let orgId = 'system';
    const tournamentId = request.params.tournamentId || request.body.tournamentId;
    if (tournamentId) {
      const tournament = await this.prisma.tournament.findFirst({
        where: { id: tournamentId, deletedAt: null },
        select: { organizationId: true },
      });
      if (tournament) {
        orgId = tournament.organizationId;
      }
    } else if (request.params.orgId) {
      orgId = request.params.orgId as string;
    }

    // Resolve Actor ID (e.g. from custom header, fallback to IP)
    const actorId = (request.headers['x-user-id'] as string) || ip;

    // Scoped Redis Rate Limit Key
    const redisKey = `rate:${orgId}:${route}:${actorId}`;

    const { limit, windowMs } = config;

    // Atomically increment request counter in Redis
    const currentCount = await this.redis.client.incr(redisKey);
    
    if (currentCount === 1) {
      // Set TTL on window start (milliseconds)
      await this.redis.client.pexpire(redisKey, windowMs);
    }

    if (currentCount > limit) {
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
