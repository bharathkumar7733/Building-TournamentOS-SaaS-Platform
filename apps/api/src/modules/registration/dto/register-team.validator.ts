import { z } from 'zod';

// ── Player sub-schema ────────────────────────────────────────────────────────

const RegisterPlayerSchema = z.object({
  /** In-game UID — must be unique per tournament (enforced at DB level too). */
  gameUid: z
    .string()
    .min(3, 'Game UID must be at least 3 characters')
    .max(50, 'Game UID must be at most 50 characters'),
  name: z
    .string()
    .min(2, 'Player name must be at least 2 characters')
    .max(80, 'Player name must be at most 80 characters'),
  isCaptain: z.boolean().default(false),
  isSubstitute: z.boolean().default(false),
});

// ── Team registration ─────────────────────────────────────────────────────

/**
 * RegisterTeamSchema
 *
 * Validates the public team registration request body.
 * Business rules enforced here:
 *   - 4 to 6 players total (per standard BR team size)
 *   - Exactly one player must be marked as captain
 *   - Player game UIDs must be unique within the submitted roster
 *   - The captain's gameUid must match captainUid (immutable after submission)
 */
export const RegisterTeamSchema = z
  .object({
    name: z
      .string()
      .min(3, 'Team name must be at least 3 characters')
      .max(80, 'Team name must be at most 80 characters'),
    /** WhatsApp number for the captain (optional but recommended) */
    whatsapp: z.string().max(20).optional(),
    /**
     * Captain's game UID — stored immutably in Team.captainUid.
     * Cannot be changed after submission even if roster is edited.
     */
    captainUid: z
      .string()
      .min(3)
      .max(50),
    captainName: z
      .string()
      .min(2, 'Captain name must be at least 2 characters')
      .max(80),
    players: z
      .array(RegisterPlayerSchema)
      .min(4, 'Team must have at least 4 players')
      .max(6, 'Team cannot have more than 6 players'),
  })
  .refine(
    (data) => {
      const captains = data.players.filter((p) => p.isCaptain);
      return captains.length === 1;
    },
    { message: 'Exactly one player must be marked as captain', path: ['players'] },
  )
  .refine(
    (data) => {
      const uids = data.players.map((p) => p.gameUid);
      return new Set(uids).size === uids.length;
    },
    {
      message: 'Duplicate game UIDs within the submitted roster are not allowed',
      path: ['players'],
    },
  )
  .refine(
    (data) => {
      const captainPlayer = data.players.find((p) => p.isCaptain);
      return captainPlayer?.gameUid === data.captainUid;
    },
    {
      message: "Captain's gameUid must match the captainUid field",
      path: ['captainUid'],
    },
  );

// ── Edit team (PENDING only) ──────────────────────────────────────────────

/**
 * EditPendingTeamSchema
 *
 * Fields that can be edited while the team is in PENDING status.
 * Captain UID is immutable after submission (locked at registration time).
 */
export const EditPendingTeamSchema = z.object({
  name: z.string().min(3).max(80).optional(),
  whatsapp: z.string().max(20).optional(),
  captainName: z.string().min(2).max(80).optional(),
  /** Players can be updated, but captainUid cannot change */
  players: z
    .array(RegisterPlayerSchema)
    .min(4)
    .max(6)
    .optional()
    .refine(
      (players) => {
        if (!players) return true;
        const captains = players.filter((p) => p.isCaptain);
        return captains.length === 1;
      },
      { message: 'Exactly one player must be marked as captain' },
    )
    .refine(
      (players) => {
        if (!players) return true;
        const uids = players.map((p) => p.gameUid);
        return new Set(uids).size === uids.length;
      },
      { message: 'Duplicate game UIDs are not allowed' },
    ),
});

// ── Admin: reject team ───────────────────────────────────────────────────────

export const RejectTeamSchema = z.object({
  reason: z.string().min(5, 'Rejection reason must be at least 5 characters').max(500),
});

// ── Admin: bulk approve ───────────────────────────────────────────────────────

export const BulkApproveSchema = z.object({
  teamIds: z
    .array(z.string().cuid())
    .min(1, 'At least one team ID is required')
    .max(100, 'Cannot bulk approve more than 100 teams at once'),
  reason: z.string().max(500).optional(),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type RegisterTeamInput = z.infer<typeof RegisterTeamSchema>;
export type EditPendingTeamInput = z.infer<typeof EditPendingTeamSchema>;
export type RejectTeamInput = z.infer<typeof RejectTeamSchema>;
export type BulkApproveInput = z.infer<typeof BulkApproveSchema>;

