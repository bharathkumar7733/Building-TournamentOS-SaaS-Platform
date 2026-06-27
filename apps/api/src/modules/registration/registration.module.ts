import { Module } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import {
  PublicRegistrationController,
  AdminRegistrationController,
} from './registration.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { MetricsModule } from '../tournament/metrics.module';

@Module({
  imports: [PrismaModule, EventsModule, MetricsModule],
  controllers: [PublicRegistrationController, AdminRegistrationController],
  providers: [RegistrationService],
  exports: [RegistrationService],
})
export class RegistrationModule {}
