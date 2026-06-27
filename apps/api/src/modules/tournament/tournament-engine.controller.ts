import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { TournamentEngineService } from './services/tournament-engine.service';
import { ok } from '../../common/api-response';

const MOCK_ACTOR_ID = 'mock-admin-id';

@ApiTags('Tournament Engine')
@Controller('api/v1/organizations/:orgId')
export class TournamentEngineController {
  constructor(private readonly engineService: TournamentEngineService) {}

  @Post('tournaments/:tournamentId/stages/:stageId/allocate-rooms')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Allocate approved teams into rooms' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'tournamentId', type: 'string' })
  @ApiParam({ name: 'stageId', type: 'string' })
  async allocateRooms(
    @Param('stageId') stageId: string,
    @Body() body: { strategy: 'SEQUENTIAL' | 'RANDOM' | 'SEEDED'; seed?: number },
  ) {
    const result = await this.engineService.allocateRooms(
      stageId,
      body.strategy,
      MOCK_ACTOR_ID,
      body.seed,
    );
    return ok(result);
  }

  @Post('rooms/:roomId/lock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock a room configuration (blocks manual moves)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'roomId', type: 'string' })
  async lockRoom(@Param('roomId') roomId: string) {
    const result = await this.engineService.toggleRoomLock(roomId, true, MOCK_ACTOR_ID);
    return ok(result);
  }

  @Post('rooms/:roomId/unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock a room configuration' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'roomId', type: 'string' })
  async unlockRoom(@Param('roomId') roomId: string) {
    const result = await this.engineService.toggleRoomLock(roomId, false, MOCK_ACTOR_ID);
    return ok(result);
  }

  @Post('rooms/move-team')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually move a team between rooms' })
  @ApiParam({ name: 'orgId', type: 'string' })
  async moveTeam(
    @Body()
    body: {
      teamId: string;
      fromRoomId: string;
      toRoomId: string;
      reason?: string;
    },
  ) {
    const result = await this.engineService.moveTeam(
      body.teamId,
      body.fromRoomId,
      body.toRoomId,
      MOCK_ACTOR_ID,
      body.reason,
    );
    return ok(result);
  }

  @Post('matches/:matchId/score')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Input performances and score a match' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'matchId', type: 'string' })
  async scoreMatch(
    @Param('matchId') matchId: string,
    @Body()
    body: {
      performances: Array<{ teamId: string; placement: number; kills: number }>;
    },
  ) {
    const result = await this.engineService.scoreMatch(
      matchId,
      body.performances,
      MOCK_ACTOR_ID,
    );
    return ok(result);
  }

  @Post('stages/:stageId/qualify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run standings evaluation and qualify teams for next stage' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'stageId', type: 'string' })
  async qualifyStage(
    @Param('stageId') stageId: string,
    @Body()
    body: {
      qualifyCount: number;
      tieBreakers?: Array<'kills' | 'placement'>;
    },
  ) {
    const result = await this.engineService.qualifyStage(
      stageId,
      body.qualifyCount,
      MOCK_ACTOR_ID,
      body.tieBreakers,
    );
    return ok(result);
  }
}
