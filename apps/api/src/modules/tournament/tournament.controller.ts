import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { TournamentService } from './tournament.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateTournamentSchema,
  UpdateTournamentSchema,
} from './dto/tournament.validator';
import type { CreateTournamentInput, UpdateTournamentInput } from './dto/tournament.validator';
import { TournamentStatus, FreezeScope } from '@prisma/client';
import { ok } from '../../common/api-response';

/** Temporary actor shim — replaced by JWT guard in Phase 2 auth */
const MOCK_ACTOR_ID = 'mock-admin-id';

@ApiTags('Tournaments')
@Controller('api/v1/organizations/:orgId/tournaments')
export class TournamentController {
  constructor(private readonly tournamentService: TournamentService) {}

  // ── CREATE ────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new tournament' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiResponse({ status: 201, description: 'Tournament created.' })
  async create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(CreateTournamentSchema)) dto: CreateTournamentInput,
  ) {
    const data = await this.tournamentService.create(orgId, dto, MOCK_ACTOR_ID);
    return ok(data);
  }

  // ── LIST ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List tournaments with pagination and filters' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: TournamentStatus })
  @ApiQuery({ name: 'search', required: false, type: String })
  async findAll(
    @Param('orgId') orgId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: TournamentStatus,
    @Query('search') search?: string,
  ) {
    const result = await this.tournamentService.findAll(orgId, {
      page,
      limit,
      status,
      search,
    });
    return ok(result.data, result.meta);
  }

  // ── DASHBOARD METRICS (Fix 6) ─────────────────────────────────────────────

  @Get('metrics/overview')
  @ApiOperation({ summary: 'Real-time dashboard metrics for the organization' })
  @ApiParam({ name: 'orgId', type: 'string' })
  async getMetrics(@Param('orgId') orgId: string) {
    const data = await this.tournamentService.getDashboardMetrics(orgId);
    return ok(data);
  }

  // ── GET ONE ───────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get tournament by ID (includes stages & rooms)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'id', type: 'string' })
  async findOne(@Param('orgId') orgId: string, @Param('id') id: string) {
    const data = await this.tournamentService.findOne(orgId, id);
    return ok(data);
  }

  // ── PUBLISH READINESS (Fix 3) ─────────────────────────────────────────────

  @Get(':id/publish-readiness')
  @ApiOperation({ summary: 'Check if tournament meets all conditions to publish' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'id', type: 'string' })
  async getPublishReadiness(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    const data = await this.tournamentService.getPublishReadiness(orgId, id);
    return ok(data);
  }

  // ── UPDATE (Fix 4 — locked fields enforced in service) ────────────────────

  @Patch(':id')
  @ApiOperation({ summary: 'Update tournament (locked fields enforced post-publish)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'id', type: 'string' })
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTournamentSchema)) dto: UpdateTournamentInput,
  ) {
    const data = await this.tournamentService.update(orgId, id, dto, MOCK_ACTOR_ID);
    return ok(data);
  }

  // ── PUBLISH (Fix 3 — gated by readiness) ──────────────────────────────────

  @Patch(':id/publish')
  @ApiOperation({ summary: 'Publish tournament (runs full readiness checklist first)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'id', type: 'string' })
  async publish(@Param('orgId') orgId: string, @Param('id') id: string) {
    const data = await this.tournamentService.publish(orgId, id, MOCK_ACTOR_ID);
    return ok(data);
  }

  // ── STATUS TRANSITION ──────────────────────────────────────────────────────

  @Patch(':id/status')
  @ApiOperation({ summary: 'Transition tournament to next valid status' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'id', type: 'string' })
  async transitionStatus(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body('status') status: TournamentStatus,
  ) {
    const data = await this.tournamentService.transitionStatus(
      orgId,
      id,
      status,
      MOCK_ACTOR_ID,
    );
    return ok(data);
  }

  // ── FREEZE (Hardening Revision 1) ─────────────────────────────────────────

  @Patch(':id/freeze')
  @ApiOperation({ summary: 'Freeze or unfreeze all tournament operations' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'id', type: 'string' })
  async toggleFreeze(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body('freeze') freeze: boolean,
    @Body('expectedVersion') expectedVersion: number,
    @Body('reason') reason?: string,
    @Body('scopes') scopes?: FreezeScope[],
    @Body('freezeExpiresAt') freezeExpiresAt?: string,
  ) {
    const expiresAtDate = freezeExpiresAt ? new Date(freezeExpiresAt) : undefined;
    const data = await this.tournamentService.toggleFreeze(
      orgId,
      id,
      freeze,
      expectedVersion,
      MOCK_ACTOR_ID,
      reason,
      scopes,
      expiresAtDate,
    );
    return ok(data);
  }

  @Post(':id/admin/recompute/replay/:deadLetterId')
  @ApiOperation({ summary: 'Replay a failed standings recompute job from the DLQ' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiParam({ name: 'deadLetterId', type: 'string' })
  async replayDeadLetter(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('deadLetterId') deadLetterId: string,
  ) {
    const data = await this.tournamentService.replayDeadLetter(
      orgId,
      id,
      deadLetterId,
    );
    return ok(data);
  }

  // ── SOFT DELETE ────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete tournament (sets deletedAt)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'id', type: 'string' })
  async delete(@Param('orgId') orgId: string, @Param('id') id: string) {
    const data = await this.tournamentService.softDelete(orgId, id, MOCK_ACTOR_ID);
    return ok(data);
  }
}
