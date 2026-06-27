import { MatchStateMachine } from './match-state-machine';
import { MatchState } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

describe('MatchStateMachine', () => {
  it('should validate valid transitions correctly', () => {
    expect(() => MatchStateMachine.validateTransition(MatchState.UPCOMING, MatchState.LIVE)).not.toThrow();
    expect(() => MatchStateMachine.validateTransition(MatchState.LIVE, MatchState.PAUSED)).not.toThrow();
    expect(() => MatchStateMachine.validateTransition(MatchState.LIVE, MatchState.COMPLETED)).not.toThrow();
    expect(() => MatchStateMachine.validateTransition(MatchState.LIVE, MatchState.ABANDONED)).not.toThrow();
    expect(() => MatchStateMachine.validateTransition(MatchState.PAUSED, MatchState.LIVE)).not.toThrow();
    expect(() => MatchStateMachine.validateTransition(MatchState.PAUSED, MatchState.ABANDONED)).not.toThrow();
    expect(() => MatchStateMachine.validateTransition(MatchState.LIVE, MatchState.LIVE)).not.toThrow();
  });

  it('should throw ConflictException for invalid transitions', () => {
    expect(() => MatchStateMachine.validateTransition(MatchState.UPCOMING, MatchState.PAUSED)).toThrow(ConflictException);
    expect(() => MatchStateMachine.validateTransition(MatchState.UPCOMING, MatchState.COMPLETED)).toThrow(ConflictException);
    expect(() => MatchStateMachine.validateTransition(MatchState.COMPLETED, MatchState.LIVE)).toThrow(ConflictException);
    expect(() => MatchStateMachine.validateTransition(MatchState.ABANDONED, MatchState.LIVE)).toThrow(ConflictException);
  });

  it('should only allow editing scores when match is LIVE', () => {
    expect(() => MatchStateMachine.assertCanEditScore(MatchState.LIVE)).not.toThrow();
    expect(() => MatchStateMachine.assertCanEditScore(MatchState.UPCOMING)).toThrow(ConflictException);
    expect(() => MatchStateMachine.assertCanEditScore(MatchState.COMPLETED)).toThrow(ConflictException);
  });
});
