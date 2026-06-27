import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsService } from '../services/metrics.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class MatchGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MatchGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    this.metrics.setGauge(
      'socket_clients_connected',
      this.metrics.getGauge('socket_clients_connected') + 1,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.metrics.setGauge(
      'socket_clients_connected',
      Math.max(0, this.metrics.getGauge('socket_clients_connected') - 1),
    );
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { scope: 'room' | 'match' | 'overlay'; id: string; lastVersion?: number },
  ) {
    const { scope, id, lastVersion } = payload;
    if (!scope || !id) {
      return { event: 'error', data: 'Invalid payload: scope and id are required' };
    }

    const roomName = `${scope}:${id}`;
    client.join(roomName);
    this.logger.log(`Client ${client.id} subscribed to ${roomName}`);

    // WebSocket Recovery Sync Protocol
    if (lastVersion !== undefined) {
      try {
        if (scope === 'room') {
          // Fetch latest active RoomStandingSnapshot
          const latestSnapshot = await this.prisma.roomStandingSnapshot.findFirst({
            where: { roomId: id, active: true },
          });
          if (latestSnapshot && latestSnapshot.version > lastVersion) {
            client.emit('room:standings', {
              roomId: id,
              version: latestSnapshot.version,
              standings: latestSnapshot.standings,
            });
            this.metrics.incrementCounter('overlay_reconnect_total');
            this.metrics.incrementCounter('socket_recovery_total');
          }
        } else if (scope === 'match') {
          // Fetch latest MatchResult list
          const match = await this.prisma.match.findUnique({
            where: { id },
            include: { results: true },
          });
          if (match) {
            // Find max score version among results
            const maxVersion = match.results.reduce((max, r) => Math.max(max, r.scoreVersion), 0);
            if (maxVersion > lastVersion) {
              client.emit('match:update', {
                matchId: id,
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
              this.metrics.incrementCounter('overlay_reconnect_total');
              this.metrics.incrementCounter('socket_recovery_total');
            }
          }
        }
      } catch (err) {
        this.logger.error(`Sync recovery failed for ${client.id} on ${roomName}:`, err);
      }
    }

    return { event: 'subscribed', data: { room: roomName } };
  }

  /**
   * Broadcast updates to a specific room channel.
   */
  broadcastToRoom(roomName: string, eventName: string, data: any) {
    if (this.server) {
      this.server.to(roomName).emit(eventName, data);
      this.metrics.incrementCounter('gateway_emit_total');
    }
  }
}
