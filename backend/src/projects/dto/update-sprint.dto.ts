import { IsString, IsOptional, IsEnum, IsISO8601, MaxLength } from 'class-validator';
import { SprintStatus } from '@prisma/client';

export class UpdateSprintDto {
  @IsString()
  @IsOptional()
  @MaxLength(191)
  name?: string;

  @IsISO8601()
  @MaxLength(64)
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @MaxLength(64)
  @IsOptional()
  endDate?: string;

  @IsEnum(SprintStatus)
  @IsOptional()
  status?: SprintStatus;
}
