import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse as ApiSwaggerResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RegistrationService } from './registration.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  RegisterTeamSchema,
  EditPendingTeamSchema,
  RejectTeamSchema,
  BulkApproveSchema,
} from './dto/register-team.validator';
import type {
  RegisterTeamInput,
  EditPendingTeamInput,
  RejectTeamInput,
  BulkApproveInput,
} from './dto/register-team.validator';
import { TeamStatus } from '@prisma/client';
import { ok } from '../../common/api-response';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { RateLimit } from '../../common/guards/rate-limit.decorator';

/** Temporary actor shim — replaced by JWT guard in Phase 3 auth */
const MOCK_ACTOR_ID = 'mock-admin-id';

// ── Public registration routes ─────────────────────────────────────────────

@ApiTags('Registration (Public)')
@Controller('api/v1/tournaments/:tournamentId')
export class PublicRegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  /**
   * POST /api/v1/tournaments/:tournamentId/register
   *
   * Public-facing team registration. No authentication required.
   * - If tournament is at capacity, team is WAITLISTED with a position.
   * - Duplicate player UIDs within the same tournament return 409.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @RateLimit(5, 60000) // 5 requests per 60 seconds
  @ApiOperation({ summary: 'Register a team for a tournament (public)' })
  @ApiParam({ name: 'tournamentId', type: 'string' })
  @ApiSwaggerResponse({ status: 201, description: 'Team registered or waitlisted.' })
  @ApiSwaggerResponse({ status: 400, description: 'Registration closed or invalid input.' })
  @ApiSwaggerResponse({ status: 409, description: 'Duplicate player UID in this tournament.' })
  async registerTeam(
    @Param('tournamentId') tournamentId: string,
    @Body(new ZodValidationPipe(RegisterTeamSchema)) dto: RegisterTeamInput,
  ) {
    const data = await this.registrationService.registerTeam(tournamentId, dto);
    return ok(data);
  }

  /**
   * PATCH /api/v1/tournaments/:tournamentId/registrations/:teamId
   *
   * Edit team details while in PENDING status only.
   * - captainUid is immutable and cannot be changed.
   * - Changing players will re-validate gameUid uniqueness.
   */
  @Patch('registrations/:teamId')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Edit a pending team registration (public)' })
  @ApiParam({ name: 'tournamentId', type: 'string' })
  @ApiParam({ name: 'teamId', type: 'string' })
  @ApiSwaggerResponse({ status: 200, description: 'Team updated.' })
  @ApiSwaggerResponse({ status: 409, description: 'Team is not in PENDING status.' })
  async editTeam(
    @Param('tournamentId') tournamentId: string,
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(EditPendingTeamSchema)) dto: EditPendingTeamInput,
  ) {
    const data = await this.registrationService.editPendingTeam(tournamentId, teamId, dto);
    return ok(data);
  }

  /**
   * GET /api/v1/tournaments/:tournamentId/teams/:teamId/status
   *
   * Check registration status of a specific team.
   * Returns waitlistPosition if WAITLISTED.
   */
  @Get('teams/:teamId/status')
  @RateLimit(30, 60000) // 30 requests per 60 seconds
  @ApiOperation({ summary: 'Get team registration status (public)' })
  @ApiParam({ name: 'tournamentId', type: 'string' })
  @ApiParam({ name: 'teamId', type: 'string' })
  async getTeamStatus(
    @Param('tournamentId') tournamentId: string,
    @Param('teamId') teamId: string,
  ) {
    const data = await this.registrationService.getTeamStatus(tournamentId, teamId);
    return ok(data);
  }
}

// ── Admin registration routes ──────────────────────────────────────────────

@ApiTags('Registration (Admin)')
@Controller('api/v1/organizations/:orgId/tournaments/:tournamentId/registrations')
export class AdminRegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  /**
   * GET /api/v1/organizations/:orgId/tournaments/:tournamentId/registrations
   *
   * Lists all registered teams with optional status filter and pagination.
   */
  @Get()
  @ApiOperation({ summary: 'List all team registrations for a tournament (admin)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'tournamentId', type: 'string' })
  @ApiQuery({ name: 'status', required: false, enum: TeamStatus })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listRegistrations(
    @Param('tournamentId') tournamentId: string,
    @Query('status') status?: TeamStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.registrationService.listTeams(tournamentId, {
      status,
      page,
      limit,
    });
    return ok(result.data, result.meta);
  }

  /**
   * POST /api/v1/organizations/:orgId/tournaments/:tournamentId/registrations/:teamId/approve
   *
   * Approves a PENDING or WAITLISTED team.
   * Uses SELECT FOR UPDATE to serialize concurrent approvals.
   */
  @Post(':teamId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a team registration (admin)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'tournamentId', type: 'string' })
  @ApiParam({ name: 'teamId', type: 'string' })
  async approveTeam(
    @Param('tournamentId') tournamentId: string,
    @Param('teamId') teamId: string,
    @Body() body?: { reason?: string },
  ) {
    const data = await this.registrationService.approveTeam(
      tournamentId,
      teamId,
      MOCK_ACTOR_ID,
      body?.reason,
    );
    return ok(data);
  }

  /**
   * POST /api/v1/organizations/:orgId/tournaments/:tournamentId/registrations/:teamId/reject
   *
   * Rejects a team. Requires a rejection reason.
   */
  @Post(':teamId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a team registration (admin)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'tournamentId', type: 'string' })
  @ApiParam({ name: 'teamId', type: 'string' })
  async rejectTeam(
    @Param('tournamentId') tournamentId: string,
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(RejectTeamSchema)) dto: RejectTeamInput,
  ) {
    const data = await this.registrationService.rejectTeam(
      tournamentId,
      teamId,
      dto,
      MOCK_ACTOR_ID,
    );
    return ok(data);
  }

  /**
   * POST /api/v1/organizations/:orgId/tournaments/:tournamentId/registrations/bulk-approve
   *
   * Bulk-approves multiple teams in a single transaction.
   * Uses SELECT FOR UPDATE on Tournament row for the entire batch.
   * Teams that cannot be approved (capacity, wrong status) are skipped with a reason.
   */
  @Post('bulk-approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk approve multiple team registrations (admin)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'tournamentId', type: 'string' })
  async bulkApprove(
    @Param('tournamentId') tournamentId: string,
    @Body(new ZodValidationPipe(BulkApproveSchema)) dto: BulkApproveInput,
  ) {
    const data = await this.registrationService.bulkApprove(
      tournamentId,
      dto,
      MOCK_ACTOR_ID,
    );
    return ok(data);
  }

  /**
   * GET /api/v1/organizations/:orgId/tournaments/:tournamentId/registrations/export
   *
   * Downloads all team registrations as a CSV file.
   */
  @Get('export')
  @ApiOperation({ summary: 'Export all team registrations as CSV (admin)' })
  @ApiParam({ name: 'orgId', type: 'string' })
  @ApiParam({ name: 'tournamentId', type: 'string' })
  async exportCsv(
    @Param('tournamentId') tournamentId: string,
    @Res() res: Response,
  ) {
    const csv = await this.registrationService.exportTeamsCsv(tournamentId);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="registrations-${tournamentId}-${Date.now()}.csv"`,
    );
    res.send(csv);
  }
}
