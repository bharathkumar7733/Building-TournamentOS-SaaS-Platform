import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DomainEventBus } from '../../events/domain-event-bus.service';
import { MatchGateway } from '../gateways/match.gateway';
import { StandingsWorkerService } from './standings-worker.service';
import { DomainEventPayload } from '../../events/domain-events.types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MatchEventHandler implements OnModuleInit {
  private readonly logger = new Logger(MatchEventHandler.name);

  constructor(
    private readonly eventBus: DomainEventBus,
    private readonly gateway: MatchGateway,
    private readonly worker: StandingsWorkerService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.logger.log('Registering MatchEventHandler domain event subscriptions');
    this.eventBus.subscribe((event) => {
      this.handleEvent(event).catch((err) => {
        this.logger.error(`Failed to handle domain event ${event.type}:`, err);
      });
    });
  }

  private async handleEvent(event: DomainEventPayload) {
    const { type, data } = event;

    switch (type) {
      case 'MatchStarted': {
        const payload = data as any;
        this.gateway.broadcastToRoom(`match:${payload.matchId}`, 'match:started', payload);
        break;
      }
      case 'MatchPaused': {
        const payload = data as any;
        this.gateway.broadcastToRoom(`match:${payload.matchId}`, 'match:paused', payload);
        break;
      }
      case 'MatchResumed': {
        const payload = data as any;
        this.gateway.broadcastToRoom(`match:${payload.matchId}`, 'match:resumed', payload);
        break;
      }
      case 'MatchCompleted': {
        const payload = data as any;
        this.gateway.broadcastToRoom(`match:${payload.matchId}`, 'match:completed', payload);
        
        // Enqueue Room and Stage recomputations
        await this.worker.enqueueJob('ROOM', payload.roomId);
        const room = await this.prisma.room.findUnique({
          where: { id: payload.roomId },
          include: { round: true },
        });
        if (room) {
          await this.worker.enqueueJob('STAGE', room.round.stageId);
        }
        break;
      }
      case 'MatchAbandoned': {
        const payload = data as any;
        this.gateway.broadcastToRoom(`match:${payload.matchId}`, 'match:abandoned', payload);
        break;
      }
      case 'ScoreUpdated':
      case 'ScoreReverted': {
        const payload = data as any;
        
        // Fetch current match context first to find room ID
        const match = await this.prisma.match.findUnique({
          where: { id: payload.matchId },
          include: { results: true },
        });
        if (match) {
          const maxVersion = match.results.reduce((max, r) => Math.max(max, r.scoreVersion), 0);
          this.gateway.broadcastToRoom(`match:${payload.matchId}`, 'match:update', {
            matchId: payload.matchId,
            roomId: match.roomId,
            state: match.state,
            updatedAt: match.updatedAt,
            version: maxVersion,
            standings: match.results.map((r) => ({
              teamId: r.teamId,
              kills: r.kills,
              placement: r.placement,
              points: r.placementPoints + r.killsPoints,
            })),
          });

          // Enqueue Room recomputation
          await this.worker.enqueueJob('ROOM', match.roomId);
        }
        break;
      }
      case 'StandingsChanged': {
        const payload = data as any;
        if (payload.scope === 'ROOM') {
          this.gateway.broadcastToRoom(`room:${payload.scopeId}`, 'room:standings', {
            roomId: payload.scopeId,
            version: payload.version,
            standings: payload.standings,
          });
        } else if (payload.scope === 'STAGE') {
          this.gateway.broadcastToRoom(`overlay:${event.tournamentId}`, 'stage:standings', {
            stageId: payload.scopeId,
            version: payload.version,
            standings: payload.standings,
          });
        }
        break;
      }
    }
  }
}
