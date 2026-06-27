import { Controller, Post, Get, Body, Param, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { MatchService } from './services/match.service';
import { MatchState } from '@prisma/client';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import { ok } from '../../common/api-response';

const TransitionSchema = z.object({
  state: z.nativeEnum(MatchState),
});

const ScoreResultSchema = z.object({
  teamId: z.string().cuid(),
  kills: z.number().int().min(0),
  placement: z.number().int().min(0),
  version: z.number().int().min(1),
});

type TransitionInput = z.infer<typeof TransitionSchema>;
type ScoreResultInput = z.infer<typeof ScoreResultSchema>;

@Controller('api/v1/tournaments/:tournamentId/matches/:matchId')
export class MatchController {
  constructor(private readonly matchService: MatchService) {}

  @Post('transition')
  @HttpCode(HttpStatus.OK)
  async transition(
    @Param('matchId') matchId: string,
    @Body(new ZodValidationPipe(TransitionSchema)) body: TransitionInput,
  ) {
    const actorId = 'mock-admin-id';
    const data = await this.matchService.transitionState(matchId, body.state, actorId);
    return ok(data);
  }

  @Post('results')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  async updateResults(
    @Param('matchId') matchId: string,
    @Body(new ZodValidationPipe(ScoreResultSchema)) body: ScoreResultInput,
  ) {
    const actorId = 'mock-admin-id';
    const data = await this.matchService.updateScore(
      matchId,
      body.teamId,
      body.kills,
      body.placement,
      body.version,
      actorId,
    );
    return ok(data);
  }

  @Post('results/revert')
  @HttpCode(HttpStatus.OK)
  async revertResults(
    @Param('matchId') matchId: string,
    @Body(new ZodValidationPipe(ScoreResultSchema)) body: ScoreResultInput,
  ) {
    const actorId = 'mock-admin-id';
    const data = await this.matchService.revertScore(
      matchId,
      body.teamId,
      body.kills,
      body.placement,
      body.version,
      actorId,
    );
    return ok(data);
  }

  @Get('status')
  async getStatus(@Param('matchId') matchId: string) {
    const data = await this.matchService.getMatchStatus(matchId);
    return ok(data);
  }
}
