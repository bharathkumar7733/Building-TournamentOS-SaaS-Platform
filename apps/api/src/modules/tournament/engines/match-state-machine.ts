import { MatchState } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

export class MatchStateMachine {
  /**
   * Validates if a transition from source to target is valid.
   * Throws ConflictException if invalid.
   */
  static validateTransition(from: MatchState, to: MatchState): void {
    if (from === to) {
      return;
    }

    const allowedTransitions: Record<MatchState, MatchState[]> = {
      [MatchState.UPCOMING]: [MatchState.LIVE],
      [MatchState.LIVE]: [MatchState.PAUSED, MatchState.COMPLETED, MatchState.ABANDONED],
      [MatchState.PAUSED]: [MatchState.LIVE, MatchState.ABANDONED],
      [MatchState.COMPLETED]: [],
      [MatchState.ABANDONED]: [],
    };

    const allowed = allowedTransitions[from] || [];
    if (!allowed.includes(to)) {
      throw new ConflictException(
        `Invalid match state transition from ${from} to ${to}.`,
      );
    }
  }

  /**
   * Check if scores/results can be edited in the current state.
   * Score edits/rollbacks are only allowed while LIVE.
   */
  static assertCanEditScore(state: MatchState): void {
    if (state !== MatchState.LIVE) {
      throw new ConflictException(
        `Score edits are only allowed when match is in LIVE state. Current state: ${state}.`,
      );
    }
  }

  /**
   * Checks if the match has reached a terminal state (COMPLETED or ABANDONED).
   */
  static isTerminalState(state: MatchState): boolean {
    return state === MatchState.COMPLETED || state === MatchState.ABANDONED;
  }
}
