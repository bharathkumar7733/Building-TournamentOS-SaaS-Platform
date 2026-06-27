import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import { DomainEventType, DomainEventPayload } from './domain-events.types';
import { DomainEventService } from './domain-event.service';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from '../tournament/services/metrics.service';
import { randomUUID } from 'crypto';

const REDIS_EVENT_CHANNEL = 'tournamentos:events';

@Injectable()
export class DomainEventBus implements OnModuleInit {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly subject = new Subject<DomainEventPayload>();
  private readonly instanceId = randomUUID().substring(0, 8);

  constructor(
    private readonly domainEventService: DomainEventService,
    private readonly redisService: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit() {
    this.logger.log(`Subscribing to Redis channel: ${REDIS_EVENT_CHANNEL}`);
    
    // Subscribe asynchronously in the background to prevent startup block if Redis is offline
    this.redisService.subscriber.subscribe(REDIS_EVENT_CHANNEL).catch((err) => {
      this.logger.error(`Failed to subscribe to Redis channel ${REDIS_EVENT_CHANNEL}:`, err);
    });

    this.redisService.subscriber.on('message', (channel, message) => {
      if (channel === REDIS_EVENT_CHANNEL) {
        try {
          const envelope = JSON.parse(message);
          const event = envelope.payload as DomainEventPayload;
          const latency = Date.now() - new Date(envelope.occurredAt).getTime();
          
          this.logger.log(
            `[Redis PubSub Event] Received ${event.type} from source ${envelope.source} with traceId ${envelope.traceId}`,
          );

          this.metrics.recordHistogram('pubsub_delivery_ms', latency);
          this.subject.next(event);
        } catch (err) {
          this.logger.error('Failed to parse published Redis event envelope:', err);
        }
      }
    });
  }

  async emit<T = any>(
    type: DomainEventType,
    payload: {
      tournamentId?: string;
      actorId: string;
      data: T;
      traceId?: string;
    },
  ): Promise<void> {
    // 1. Write to DB outbox
    const dbEvent = await this.domainEventService.emit(type, payload);

    const completePayload: DomainEventPayload = {
      type,
      tournamentId: payload.tournamentId,
      actorId: payload.actorId,
      occurredAt: dbEvent.createdAt.toISOString(),
      data: payload.data,
    };

    const traceId = payload.traceId || 'trace-' + randomUUID().substring(0, 8);
    const aggregateId =
      payload.tournamentId ||
      (payload.data as any)?.matchId ||
      (payload.data as any)?.roomId ||
      (payload.data as any)?.scopeId ||
      'system';

    const version =
      (payload.data as any)?.version ??
      (payload.data as any)?.scoreVersion ??
      1;

    const envelope = {
      eventId: dbEvent.id,
      eventType: type,
      aggregateId,
      version,
      occurredAt: dbEvent.createdAt.toISOString(),
      source: `api-instance-${this.instanceId}`,
      traceId,
      payload: completePayload,
    };

    // 2. Publish to Redis PubSub
    await this.redisService.publisher.publish(
      REDIS_EVENT_CHANNEL,
      JSON.stringify(envelope),
    );
  }

  /**
   * Subscribe to events in-memory.
   */
  subscribe(callback: (event: DomainEventPayload) => any) {
    return this.subject.subscribe(callback);
  }
}
