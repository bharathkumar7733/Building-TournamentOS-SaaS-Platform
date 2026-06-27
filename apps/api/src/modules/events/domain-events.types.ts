/**
 * Domain Event types — each event maps to a DomainEvent.type in the DB.
 *
 * Follow the pattern: EntityVerb (PascalCase past tense).
 * These are persisted via the outbox pattern in DomainEvent table, then
 * dispatched asynchronously by DomainEventDispatcher.
 */

export type DomainEventType =
  | 'TournamentCreated'
  | 'TournamentPublished'
  | 'TournamentStatusChanged'
  | 'TournamentDeleted'
  | 'TournamentFrozen'
  | 'TournamentUnfrozen'
  | 'TournamentFreezeExpired'
  | 'StageCreated'
  | 'StageDeleted'
  | 'TeamRegistered'
  | 'TeamApproved'
  | 'TeamRejected'
  | 'TeamWaitlisted'
  | 'TeamDeleted'
  | 'RoomAssigned'
  | 'MatchResultSubmitted'
  | 'TeamQualified'
  | 'TeamEliminated'
  | 'MatchStarted'
  | 'MatchPaused'
  | 'MatchResumed'
  | 'ScoreUpdated'
  | 'ScoreReverted'
  | 'MatchCompleted'
  | 'MatchAbandoned'
  | 'StandingsChanged'
  | 'StandingsDirty';

export interface DomainEventPayload<T = unknown> {
  type: DomainEventType;
  tournamentId?: string;
  actorId: string;
  occurredAt: string; // ISO 8601
  data: T;
}

// ── Concrete payload shapes ────────────────────────────────────────────────

export interface TournamentCreatedPayload {
  name: string;
  game: string;
  organizationId: string;
}

export interface TournamentStatusChangedPayload {
  from: string;
  to: string;
}

export interface TournamentPublishedPayload {
  name: string;
  startDate: string;
}

export interface TeamRegisteredPayload {
  teamId: string;
  teamName: string;
  captainName?: string;
}

export interface TeamQualifiedPayload {
  teamId: string;
  stageId: string;
  source: 'AUTO' | 'ADMIN_OVERRIDE';
}

export interface MatchStartedPayload {
  matchId: string;
  roomId: string;
  startedAt: string;
}

export interface MatchPausedPayload {
  matchId: string;
  pausedAt: string;
}

export interface MatchResumedPayload {
  matchId: string;
  resumedAt: string;
}

export interface ScoreUpdatedPayload {
  matchId: string;
  teamId: string;
  kills: number;
  placement: number;
  points: number;
  scoreVersion: number;
}

export interface ScoreRevertedPayload {
  matchId: string;
  teamId: string;
  kills: number;
  placement: number;
  points: number;
  scoreVersion: number;
}

export interface MatchCompletedPayload {
  matchId: string;
  roomId: string;
  endedAt: string;
}

export interface MatchAbandonedPayload {
  matchId: string;
  roomId: string;
  endedAt: string;
}

export interface StandingsChangedPayload {
  scope: 'ROOM' | 'STAGE';
  scopeId: string;
  version: number;
  standings: any[];
}

export interface StandingsDirtyPayload {
  scope: 'ROOM' | 'STAGE';
  scopeId: string;
}
