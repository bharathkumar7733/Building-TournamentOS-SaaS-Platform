import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTournamentDto {
  @ApiProperty({ example: 'Summer BR Championship 2026', minLength: 3, maxLength: 100 })
  name!: string;

  @ApiProperty({ example: 'VALORANT' })
  game!: string;

  @ApiProperty({ example: '2026-07-01T12:00:00Z', description: 'ISO 8601 date string' })
  startDate!: string;

  @ApiPropertyOptional({ example: 'No cheats allowed. Play fair!', maxLength: 10000 })
  rules?: string;

  @ApiProperty({ example: 100, minimum: 2, maximum: 1000 })
  maxTeams!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 100, default: 20 })
  roomCapacity!: number;

  @ApiProperty({ enum: ['TOP_X_PER_ROOM', 'OVERALL_RANKING', 'MANUAL'], example: 'TOP_X_PER_ROOM' })
  qualificationType!: 'TOP_X_PER_ROOM' | 'OVERALL_RANKING' | 'MANUAL';
}
