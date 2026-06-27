import { Team, TeamStatus } from '@prisma/client';
import {
  SequentialAllocationStrategy,
  RandomAllocationStrategy,
  SeededAllocationStrategy,
} from './room-allocation.strategy';

describe('RoomAllocationStrategy', () => {
  const createMockTeams = (count: number): Team[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `team-${i + 1}`,
      tournamentId: 't1',
      name: `Team ${i + 1}`,
      captainName: `Captain ${i + 1}`,
      captainUid: `uid-${i + 1}`,
      whatsapp: null,
      status: TeamStatus.APPROVED,
      waitlistPosition: null,
      registrationSnapshot: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      previousStatus: null,
      statusChangedAt: null,
      statusChangedBy: null,
      statusReason: null,
      statusSource: null,
    }));
  };

  describe('SequentialAllocationStrategy', () => {
    const strategy = new SequentialAllocationStrategy();

    it('should split teams sequentially into rooms matching capacity', () => {
      const teams = createMockTeams(5);
      const rooms = strategy.allocate(teams, 2);

      expect(rooms).toHaveLength(3);
      expect(rooms[0]).toHaveLength(2);
      expect(rooms[0][0].id).toBe('team-1');
      expect(rooms[0][1].id).toBe('team-2');
      expect(rooms[1][0].id).toBe('team-3');
      expect(rooms[1][1].id).toBe('team-4');
      expect(rooms[2][0].id).toBe('team-5');
    });
  });

  describe('RandomAllocationStrategy', () => {
    const strategy = new RandomAllocationStrategy();

    it('should shuffle teams randomly and return consistent results for a given seed', () => {
      const teams = createMockTeams(10);
      const seed = 42;

      const allocation1 = strategy.allocate(teams, 3, seed);
      const allocation2 = strategy.allocate(teams, 3, seed);

      // Verify stability: same seed = same layout
      expect(allocation1).toEqual(allocation2);

      // Verify that another seed yields a different (or at least independent) output
      const allocationDifferentSeed = strategy.allocate(teams, 3, 99);
      const order1 = allocation1.flat().map((t) => t.id);
      const order2 = allocationDifferentSeed.flat().map((t) => t.id);
      expect(order1).not.toEqual(order2);
    });
  });

  describe('SeededAllocationStrategy (Snake Draft)', () => {
    const strategy = new SeededAllocationStrategy();

    it('should distribute teams using a snake pattern', () => {
      const teams = createMockTeams(6); // Seeded order: team-1 to team-6
      // Snake order with 3 rooms (since capacity=2, ceil(6/2)=3):
      // Round 1 (L->R): Room 0 -> team-1, Room 1 -> team-2, Room 2 -> team-3
      // Round 2 (R->L): Room 2 -> team-4, Room 1 -> team-5, Room 0 -> team-6
      const rooms = strategy.allocate(teams, 2);

      expect(rooms).toHaveLength(3);
      expect(rooms[0].map(t => t.id)).toEqual(['team-1', 'team-6']);
      expect(rooms[1].map(t => t.id)).toEqual(['team-2', 'team-5']);
      expect(rooms[2].map(t => t.id)).toEqual(['team-3', 'team-4']);
    });
  });
});
