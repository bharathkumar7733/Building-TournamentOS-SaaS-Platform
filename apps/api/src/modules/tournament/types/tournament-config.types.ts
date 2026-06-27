/**
 * TournamentConfig — stored as JSONB in Tournament.config
 *
 * This is the single source of truth for all tournament scoring configuration.
 * Keeps the schema migration-free as rules evolve.
 *
 * NOTE: Registration window (registrationStartsAt, registrationEndsAt) are
 * first-class database columns on Tournament — NOT stored here.
 * Only scoring/capacity config lives in this JSONB.
 */
export interface TournamentConfig {
  /** Maximum number of registered teams */
  maxTeams: number;

  /** Teams per match lobby (e.g. 20 for standard BR) */
  roomCapacity: number;

  /** How qualifiers are determined */
  qualificationType: 'TOP_X_PER_ROOM' | 'OVERALL_RANKING' | 'MANUAL';

  /**
   * Placement-to-points mapping.
   * Key = placement rank (as string), value = points awarded.
   * Example: { "1": 12, "2": 9, "3": 8, "4": 7 }
   */
  pointTable: Record<string, number>;

  /** Points awarded per kill */
  killPoints: number;

  /**
   * Tiebreaker rule when two teams have equal total points.
   */
  tiebreaker: 'kills' | 'placement';
}

/** Default config values applied when creating a new tournament */
export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  maxTeams: 240,
  roomCapacity: 20,
  qualificationType: 'TOP_X_PER_ROOM',
  pointTable: {
    '1': 12,
    '2': 9,
    '3': 8,
    '4': 7,
    '5': 6,
    '6': 5,
    '7': 4,
    '8': 3,
    '9': 2,
    '10': 1,
  },
  killPoints: 1,
  tiebreaker: 'kills',
};

/**
 * Publish readiness checklist — all must be true to publish.
 * Computed by TournamentService.getPublishReadiness()
 */
export interface PublishReadiness {
  hasName: boolean;
  hasStartDate: boolean;
  hasRules: boolean;
  hasStages: boolean;
  stagesHaveRooms: boolean;
  startDateInFuture: boolean;
  registrationWindowValid: boolean;
  ready: boolean;
  blockers: string[];
}
