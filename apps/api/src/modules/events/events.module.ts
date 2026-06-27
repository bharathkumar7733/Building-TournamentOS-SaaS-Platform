import { Module } from '@nestjs/common';
import { DomainEventService } from './domain-event.service';
import { DomainEventBus } from './domain-event-bus.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../tournament/metrics.module';

@Module({
  imports: [PrismaModule, MetricsModule],
  providers: [DomainEventService, DomainEventBus],
  exports: [DomainEventService, DomainEventBus],
})
export class EventsModule {}
