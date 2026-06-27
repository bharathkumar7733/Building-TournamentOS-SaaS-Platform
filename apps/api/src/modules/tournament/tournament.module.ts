import { Module } from '@nestjs/common';
import { TournamentService } from './tournament.service';
import { TournamentController } from './tournament.controller';
import { TournamentEngineController } from './tournament-engine.controller';
import { MatchController } from './match.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { RoomMutationPolicy } from './policies/room-mutation.policy';
import { QualificationRunService } from './services/qualification-run.service';
import { TournamentEngineService } from './services/tournament-engine.service';
import { MatchService } from './services/match.service';
import { MatchGateway } from './gateways/match.gateway';
import { StandingsWorkerService } from './services/standings-worker.service';
import { MatchEventHandler } from './services/match-event.handler';
import { MetricsModule } from './metrics.module';

@Module({
  imports: [PrismaModule, EventsModule, MetricsModule],
  controllers: [TournamentController, TournamentEngineController, MatchController],
  providers: [
    TournamentService,
    RoomMutationPolicy,
    QualificationRunService,
    TournamentEngineService,
    MatchService,
    MatchGateway,
    StandingsWorkerService,
    MatchEventHandler,
  ],
  exports: [
    TournamentService,
    RoomMutationPolicy,
    QualificationRunService,
    TournamentEngineService,
    MatchService,
    MatchGateway,
    StandingsWorkerService,
    MatchEventHandler,
    MetricsModule,
  ],
})
export class TournamentModule {}
