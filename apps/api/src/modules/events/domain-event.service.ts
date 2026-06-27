import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DomainEventPayload,
  DomainEventType,
} from './domain-events.types';

/**
 * DomainEventService
 *
 * Persists domain events to the DomainEvent table (outbox pattern).
 * Events are written in the same database transaction as the mutation,
 * guaranteeing consistency even if the async dispatcher crashes.
 *
 * Usage:
 *   await this.domainEvents.emit('TournamentPublished', {
 *     tournamentId: t.id,
 *     actorId: adminId,
 *     data: { name: t.name, startDate: t.startDate.toISOString() },
 *   });
 *
 * The DomainEventDispatcher picks up pending events via polling or a
 * pg_notify listener and broadcasts them (WebSocket gateway, webhooks, etc.)
 */
@Injectable()
export class DomainEventService {
  private readonly logger = new Logger(DomainEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a domain event (outbox write).
   * Call this inside a Prisma transaction for atomicity.
   */
  async emit<T = unknown>(
    type: DomainEventType,
    payload: Omit<DomainEventPayload<T>, 'type' | 'occurredAt'>,
  ): Promise<any> {
    const event = await this.prisma.domainEvent.create({
      data: {
        type,
        tournamentId: payload.tournamentId ?? null,
        payload: {
          ...payload,
          type,
          occurredAt: new Date().toISOString(),
        } as object,
      },
    });

    this.logger.log(`[Domain Event] ${type} — id=${event.id}`);
    return event;
  }

  /**
   * Mark an event as dispatched (called by the dispatcher worker).
   */
  async markDispatched(eventId: string): Promise<void> {
    await this.prisma.domainEvent.update({
      where: { id: eventId },
      data: { dispatchedAt: new Date() },
    });
  }

  /**
   * Fetch pending events for dispatch processing.
   * @param limit Max events to process per batch
   */
  async getPendingEvents(limit = 100) {
    return this.prisma.domainEvent.findMany({
      where: { dispatchedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
}
