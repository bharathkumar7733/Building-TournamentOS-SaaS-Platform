import { ScoringRuleEngine, TieBreakerStrategy, TeamStanding } from './scoring-rule.engine';

describe('ScoringRuleEngine & TieBreakerStrategy', () => {
  describe('ScoringRuleEngine', () => {
    const engine = new ScoringRuleEngine();

    it('should calculate points correctly based on placements and kill multipliers', () => {
      const performances = [
        { teamId: 'team-1', placement: 1, kills: 10 },
        { teamId: 'team-2', placement: 2, kills: 5 },
        { teamId: 'team-3', placement: 12, kills: 0 },
      ];

      const config = {
        placementPoints: {
          '1': 15,
          '2': 12,
          '3': 10,
        },
        killMultiplier: 2,
      };

      const result = engine.calculateScores(performances, config);

      expect(result).toHaveLength(3);
      // Team 1: 15 (placement) + 10 * 2 (kills) = 35
      expect(result.find((r) => r.teamId === 'team-1')).toEqual({
        teamId: 'team-1',
        placementPoints: 15,
        killPoints: 20,
        totalPoints: 35,
      });

      // Team 2: 12 (placement) + 5 * 2 (kills) = 22
      expect(result.find((r) => r.teamId === 'team-2')).toEqual({
        teamId: 'team-2',
        placementPoints: 12,
        killPoints: 10,
        totalPoints: 22,
      });

      // Team 3: 0 (placement points not defined for 12) + 0 * 2 (kills) = 0
      expect(result.find((r) => r.teamId === 'team-3')).toEqual({
        teamId: 'team-3',
        placementPoints: 0,
        killPoints: 0,
        totalPoints: 0,
      });
    });
  });

  describe('TieBreakerStrategy', () => {
    const sorter = new TieBreakerStrategy();

    it('should sort primarily by points', () => {
      const standings: TeamStanding[] = [
        { teamId: 't1', teamName: 'T1', points: 20, kills: 5, placements: [3] },
        { teamId: 't2', teamName: 'T2', points: 30, kills: 1, placements: [5] },
        { teamId: 't3', teamName: 'T3', points: 10, kills: 10, placements: [1] },
      ];

      const sorted = sorter.sort(standings);
      expect(sorted[0].teamId).toBe('t2'); // 30 points
      expect(sorted[1].teamId).toBe('t1'); // 20 points
      expect(sorted[2].teamId).toBe('t3'); // 10 points
    });

    it('should break ties based on kills first', () => {
      const standings: TeamStanding[] = [
        { teamId: 't1', teamName: 'T1', points: 20, kills: 5, placements: [3] },
        { teamId: 't2', teamName: 'T2', points: 20, kills: 10, placements: [5] }, // More kills
        { teamId: 't3', teamName: 'T3', points: 20, kills: 2, placements: [1] },
      ];

      const sorted = sorter.sort(standings, ['kills', 'placement']);
      expect(sorted[0].teamId).toBe('t2'); // 10 kills
      expect(sorted[1].teamId).toBe('t1'); // 5 kills
      expect(sorted[2].teamId).toBe('t3'); // 2 kills
    });

    it('should break ties based on placements (highest placements count)', () => {
      const standings: TeamStanding[] = [
        { teamId: 't1', teamName: 'T1', points: 20, kills: 5, placements: [1, 5] }, // Has a 1st place
        { teamId: 't2', teamName: 'T2', points: 20, kills: 5, placements: [2, 2] }, // Best is 2nd place
      ];

      const sorted = sorter.sort(standings, ['placement', 'kills']);
      expect(sorted[0].teamId).toBe('t1'); // wins because of 1st place occurrence
      expect(sorted[1].teamId).toBe('t2');
    });

    it('should support customized strategy priority chains', () => {
      const standings: TeamStanding[] = [
        { teamId: 't1', teamName: 'T1', points: 20, kills: 5, placements: [2, 2] },
        { teamId: 't2', teamName: 'T2', points: 20, kills: 8, placements: [3, 4] },
      ];

      // If we use 'placement' first, t1 should win (has two 2nd places vs t2's 3rd place)
      const sortedByPlacement = sorter.sort(standings, ['placement', 'kills']);
      expect(sortedByPlacement[0].teamId).toBe('t1');

      // If we use 'kills' first, t2 should win (8 kills vs 5 kills)
      const sortedByKills = sorter.sort(standings, ['kills', 'placement']);
      expect(sortedByKills[0].teamId).toBe('t2');
    });
  });
});
