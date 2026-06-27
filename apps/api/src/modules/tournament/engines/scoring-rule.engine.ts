export interface ScoringConfig {
  placementPoints: Record<string, number>;
  killMultiplier: number;
}

export interface MatchPerformance {
  teamId: string;
  placement: number;
  kills: number;
}

export interface ScoreBreakdown {
  teamId: string;
  placementPoints: number;
  killPoints: number;
  totalPoints: number;
}

export interface TeamStanding {
  teamId: string;
  teamName: string;
  points: number;
  kills: number;
  placements: number[]; // e.g. [1, 5, 2] indicating placements in match 1, 2, 3
}

export class ScoringRuleEngine {
  /**
   * Calculates scores for all teams in a match.
   */
  calculateScores(performances: MatchPerformance[], config: ScoringConfig): ScoreBreakdown[] {
    return performances.map((perf) => {
      const placementStr = String(perf.placement);
      const placementPoints = config.placementPoints[placementStr] ?? 0;
      const killPoints = perf.kills * config.killMultiplier;
      const totalPoints = placementPoints + killPoints;

      return {
        teamId: perf.teamId,
        placementPoints,
        killPoints,
        totalPoints,
      };
    });
  }
}

/**
 * Helper to count occurrences of each placement position for a team
 */
function getPlacementCounts(placements: number[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const p of placements) {
    counts[p] = (counts[p] || 0) + 1;
  }
  return counts;
}

/**
 * Standings Tie-Breaker Engine.
 * Sorts teams by points, then resolves ties based on requested strategies sequentially:
 *   1. "kills": Compares total kills.
 *   2. "placement": Compares occurrences of highest placements (e.g., number of 1st places, then 2nd places).
 */
export class TieBreakerStrategy {
  /**
   * Sorts the standings array in-place based on points and tie-breaker rules.
   */
  sort(standings: TeamStanding[], strategies: Array<'kills' | 'placement'> = ['kills', 'placement']): TeamStanding[] {
    return [...standings].sort((a, b) => {
      // 1. Primary sort: Total Points
      if (a.points !== b.points) {
        return b.points - a.points; // Descending
      }

      // 2. Secondary sort: Tie-breakers in sequential priority order
      for (const strat of strategies) {
        if (strat === 'kills') {
          if (a.kills !== b.kills) {
            return b.kills - a.kills; // More kills wins
          }
        }

        if (strat === 'placement') {
          const countsA = getPlacementCounts(a.placements);
          const countsB = getPlacementCounts(b.placements);
          // Compare placement positions from 1 up to 12
          for (let p = 1; p <= 12; p++) {
            const countA = countsA[p] || 0;
            const countB = countsB[p] || 0;
            if (countA !== countB) {
              return countB - countA; // More 1st places, 2nd places etc. wins
            }
          }
        }
      }

      return 0; // Absolute tie
    });
  }
}
