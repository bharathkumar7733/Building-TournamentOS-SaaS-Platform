import { z } from 'zod';
import { DEFAULT_TOURNAMENT_CONFIG } from '../types/tournament-config.types';

// ── Config sub-schema ──────────────────────────────────────────────────────

/**
 * TournamentConfigSchema — validates the JSONB config object.
 *
 * NOTE: registrationOpen/Close have been removed from config.
 * Registration windows are now first-class DB columns:
 *   Tournament.registrationStartsAt / registrationEndsAt
 */
const TournamentConfigSchema = z.object({
  maxTeams: z
    .number()
    .int()
    .min(2, 'Minimum teams is 2')
    .max(1000, 'Maximum teams is 1000')
    .default(DEFAULT_TOURNAMENT_CONFIG.maxTeams),
  roomCapacity: z
    .number()
    .int()
    .min(1, 'Minimum room capacity is 1')
    .max(100, 'Maximum room capacity is 100')
    .default(DEFAULT_TOURNAMENT_CONFIG.roomCapacity),
  qualificationType: z
    .enum(['TOP_X_PER_ROOM', 'OVERALL_RANKING', 'MANUAL'])
    .default(DEFAULT_TOURNAMENT_CONFIG.qualificationType),
  pointTable: z
    .record(z.string(), z.number().int().min(0))
    .default(DEFAULT_TOURNAMENT_CONFIG.pointTable),
  killPoints: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(DEFAULT_TOURNAMENT_CONFIG.killPoints),
  tiebreaker: z
    .enum(['kills', 'placement'])
    .default(DEFAULT_TOURNAMENT_CONFIG.tiebreaker),
});

// ── Create ─────────────────────────────────────────────────────────────────

export const CreateTournamentSchema = z.object({
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(100, 'Name must be at most 100 characters'),
  game: z.string().min(1, 'Game is required').max(50),
  startDate: z
    .string()
    .datetime({ message: 'Invalid ISO 8601 date string' })
    .refine((val) => new Date(val) > new Date(), {
      message: 'Start date must be in the future',
    }),
  rules: z
    .string()
    .max(10_000, 'Rules must be at most 10,000 characters')
    .optional(),
  /** Registration window — optional at creation, enforced at publish */
  registrationStartsAt: z.string().datetime().optional(),
  registrationEndsAt: z.string().datetime().optional(),
  /** Nested config object — all fields optional with defaults */
  config: TournamentConfigSchema.optional().default(DEFAULT_TOURNAMENT_CONFIG),
  /** Optional: templateId to auto-generate stages */
  templateId: z.string().cuid().optional(),
});

// ── Update ─────────────────────────────────────────────────────────────────

/**
 * Path-based lock rules: config keys that become immutable once the tournament
 * reaches REGISTRATION_OPEN or later.
 *
 * Format: 'config.<key>' — matching the nested config object paths.
 * This is more explicit than a flat key array and easier to extend.
 */
export const LOCKED_CONFIG_PATHS = [
  'maxTeams',
  'qualificationType',
  'pointTable',
] as const;

/**
 * Legacy export — alias of LOCKED_CONFIG_PATHS for backward compatibility
 * with existing service code.
 */
export const LOCKED_CONFIG_KEYS: Array<keyof z.infer<typeof TournamentConfigSchema>> =
  ['maxTeams', 'qualificationType'];

export const UpdateTournamentSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  game: z.string().min(1).max(50).optional(),
  startDate: z
    .string()
    .datetime()
    .refine((val) => new Date(val) > new Date(), {
      message: 'Start date must be in the future',
    })
    .optional(),
  rules: z.string().max(10_000).optional(),
  registrationStartsAt: z.string().datetime().nullable().optional(),
  registrationEndsAt: z.string().datetime().nullable().optional(),
  config: TournamentConfigSchema.partial().optional(),
});

export type CreateTournamentInput = z.infer<typeof CreateTournamentSchema>;
export type UpdateTournamentInput = z.infer<typeof UpdateTournamentSchema>;
export type TournamentConfigInput = z.infer<typeof TournamentConfigSchema>;
