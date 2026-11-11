import { IsString, IsNotEmpty, IsOptional, IsEnum, IsISO8601, MaxLength } from 'class-validator';
import { SprintStatus } from '@prisma/client';

export class CreateSprintDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @IsISO8601()
  @MaxLength(64)
  @IsNotEmpty()
  startDate!: string;

  @IsISO8601()
  @MaxLength(64)
  @IsNotEmpty()
  endDate!: string;

  @IsEnum(SprintStatus)
  @IsOptional()
  status?: SprintStatus;
}
