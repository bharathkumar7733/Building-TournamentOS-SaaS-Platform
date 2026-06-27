import { Team } from '@prisma/client';

export interface RoomAllocationStrategy {
  allocate(teams: Team[], roomCapacity: number, seed?: number): Team[][];
}

/**
 * Seedable random number generator (Mulberry32)
 * Guarantees identical shuffles for identical seeds.
 */
function seedRandom(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * SEQUENTIAL: Splits teams sequentially into rooms.
 */
export class SequentialAllocationStrategy implements RoomAllocationStrategy {
  allocate(teams: Team[], roomCapacity: number): Team[][] {
    const rooms: Team[][] = [];
    for (let i = 0; i < teams.length; i += roomCapacity) {
      rooms.push(teams.slice(i, i + roomCapacity));
    }
    return rooms;
  }
}

/**
 * RANDOM: Shuffles teams before splitting them.
 * Supports deterministic shuffles if a seed is provided.
 */
export class RandomAllocationStrategy implements RoomAllocationStrategy {
  allocate(teams: Team[], roomCapacity: number, seed?: number): Team[][] {
    const shuffled = [...teams];
    const rng = seed !== undefined ? seedRandom(seed) : Math.random;

    // Fisher-Yates Shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const rooms: Team[][] = [];
    for (let i = 0; i < shuffled.length; i += roomCapacity) {
      rooms.push(shuffled.slice(i, i + roomCapacity));
    }
    return rooms;
  }
}

/**
 * SEEDED (Snake Draft): Allocates teams into rooms using a snake pattern
 * to balance seed strengths across groups.
 */
export class SeededAllocationStrategy implements RoomAllocationStrategy {
  allocate(teams: Team[], roomCapacity: number): Team[][] {
    const numRooms = Math.max(1, Math.ceil(teams.length / roomCapacity));
    const rooms: Team[][] = Array.from({ length: numRooms }, () => []);

    let roomIndex = 0;
    let direction = 1;

    for (let i = 0; i < teams.length; i++) {
      rooms[roomIndex].push(teams[i]);
      roomIndex += direction;

      // Reverse direction at endpoints (snake draft)
      if (roomIndex >= numRooms) {
        roomIndex = numRooms - 1;
        direction = -1;
      } else if (roomIndex < 0) {
        roomIndex = 0;
        direction = 1;
      }
    }
    return rooms;
  }
}
