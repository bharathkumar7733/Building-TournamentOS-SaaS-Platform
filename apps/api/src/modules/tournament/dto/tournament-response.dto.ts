import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TournamentStatus } from '@prisma/client';

export class TournamentResponseDto {
  @ApiProperty({ example: 'cl1234567890abcdef' })
  id!: string;

  @ApiProperty({ example: 'mock-org-id' })
  organizationId!: string;

  @ApiProperty({ example: 'Summer BR Championship 2026' })
  name!: string;

  @ApiProperty({ example: 'VALORANT' })
  game!: string;

  @ApiProperty({ enum: TournamentStatus, example: 'DRAFT' })
  status!: TournamentStatus;

  @ApiProperty({ example: '2026-07-01T12:00:00Z' })
  startDate!: Date;

  @ApiPropertyOptional({ example: 'No cheats allowed. Play fair!' })
  rules?: string | null;

  @ApiProperty({ example: 100 })
  maxTeams!: number;

  @ApiProperty({ example: 20 })
  roomCapacity!: number;

  @ApiProperty({ example: 'TOP_X_PER_ROOM' })
  qualificationType!: string;

  @ApiProperty({ example: 'mock-admin-id' })
  createdBy!: string;

  @ApiProperty({ example: '2026-06-23T07:12:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-06-23T07:12:00.000Z' })
  updatedAt!: Date;
}
