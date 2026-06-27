import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { PrismaService } from '../../modules/prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const key = request.headers['x-idempotency-key'] as string;
    if (!key) {
      return next.handle();
    }

    // Determine organization ID scope
    let organizationId = 'SYSTEM';
    const tournamentId = request.params.tournamentId || request.body.tournamentId;
    if (tournamentId) {
      const tournament = await this.prisma.tournament.findFirst({
        where: { id: tournamentId, deletedAt: null },
        select: { organizationId: true },
      });
      if (tournament) {
        organizationId = tournament.organizationId;
      }
    }

    // Compute request hash to verify payload identity on retries
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(request.body || {}))
      .digest('hex');

    try {
      // 1. Attempt to insert key in PROCESSING state
      await this.prisma.idempotencyKey.create({
        data: {
          organizationId,
          key,
          requestHash,
          state: 'PROCESSING',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiration
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        // Key exists. Fetch existing record.
        const existing = await this.prisma.idempotencyKey.findUnique({
          where: {
            organizationId_key: { organizationId, key },
          },
        });

        if (existing) {
          if (existing.state === 'COMPLETED') {
            // Verify payload identity
            if (existing.requestHash !== requestHash) {
              throw new BadRequestException('Idempotency key payload mismatch.');
            }

            // Return cached response
            response.status(existing.responseStatus || 200);

            if (existing.responseBody) {
              return of(existing.responseBody);
            } else if (existing.resourceType && existing.resourceId) {
              const data = await this.fetchResource(existing.resourceType, existing.resourceId);
              return of(data);
            }
            return of({ success: true });
          } else if (existing.state === 'PROCESSING') {
            throw new ConflictException('A request with this idempotency key is already processing.');
          } else {
            // FAILED: Delete the failed key and allow retry execution
            await this.prisma.idempotencyKey.delete({
              where: { id: existing.id },
            });
            return this.intercept(context, next);
          }
        }
      }
      throw err;
    }

    // 2. Execute handler and save response state
    return next.handle().pipe(
      tap({
        next: async (data) => {
          try {
            const dataStr = JSON.stringify(data);
            const sizeInBytes = Buffer.byteLength(dataStr, 'utf8');
            const isUnderLimit = sizeInBytes <= 100 * 1024; // 100KB

            const updateData: any = {
              state: 'COMPLETED',
              responseStatus: response.statusCode || 201,
            };

            if (isUnderLimit) {
              updateData.responseBody = data;
            } else {
              const resourceId = data?.data?.teamId || data?.teamId || data?.id;
              updateData.resourceId = resourceId;
              updateData.resourceType = resourceId ? 'team' : null;
            }

            await this.prisma.idempotencyKey.update({
              where: { organizationId_key: { organizationId, key } },
              data: updateData,
            });
          } catch (updateErr) {
            this.logger.error('Failed to complete idempotency key update:', updateErr);
          }
        },
        error: async (err) => {
          try {
            await this.prisma.idempotencyKey.update({
              where: { organizationId_key: { organizationId, key } },
              data: { state: 'FAILED' },
            });
          } catch (updateErr) {
            this.logger.error('Failed to set idempotency key to FAILED:', updateErr);
          }
        },
      }),
    );
  }

  private async fetchResource(type: string, id: string) {
    if (type === 'team') {
      const team = await this.prisma.team.findUnique({
        where: { id },
      });
      if (team) {
        return {
          success: true,
          data: {
            teamId: team.id,
            status: team.status,
            waitlistPosition: team.waitlistPosition,
            message:
              team.status === 'WAITLISTED'
                ? `Tournament is full. You have been waitlisted at position ${team.waitlistPosition}.`
                : 'Your team has been registered and is pending review.',
          },
        };
      }
    }
    return { success: true };
  }
}
