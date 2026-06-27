import { TeamStanding } from '../engines/scoring-rule.engine';

export interface QualificationStrategy {
  qualify(
    standings: TeamStanding[],
    qualifyCount: number,
  ): {
    qualified: TeamStanding[];
    eliminated: TeamStanding[];
  };
}

/**
 * Standard Top-X qualification.
 * Qualifies the first `qualifyCount` teams from the sorted standings,
 * and marks the remaining teams as eliminated.
 */
export class TopXQualificationStrategy implements QualificationStrategy {
  qualify(
    standings: TeamStanding[],
    qualifyCount: number,
  ): {
    qualified: TeamStanding[];
    eliminated: TeamStanding[];
  } {
    const sorted = [...standings];
    const qualified = sorted.slice(0, qualifyCount);
    const eliminated = sorted.slice(qualifyCount);

    return { qualified, eliminated };
  }
}
