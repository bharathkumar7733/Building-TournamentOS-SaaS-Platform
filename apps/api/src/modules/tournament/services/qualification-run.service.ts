import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamStanding } from '../engines/scoring-rule.engine';

@Injectable()
export class QualificationRunService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Logs a completed qualification run to the database.
   */
  async recordRun(
    stageId: string,
    strategy: string,
    standings: TeamStanding[],
    configSnapshot: { strategy: string; tieBreaker: string[] },
  ) {
    return this.prisma.qualificationRun.create({
      data: {
        stageId,
        strategy,
        results: {
          standings,
          config: configSnapshot,
        } as any,
      },
    });
  }

  /**
   * Retrieves a qualification run by ID.
   */
  async getRun(runId: string) {
    const run = await this.prisma.qualificationRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      throw new NotFoundException(`Qualification run ${runId} not found.`);
    }

    return run;
  }
}
