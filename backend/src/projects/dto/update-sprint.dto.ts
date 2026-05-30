import { IsString, IsOptional, IsEnum, IsISO8601 } from 'class-validator';
import { SprintStatus } from '@prisma/client';

export class UpdateSprintDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @IsOptional()
  endDate?: string;

  @IsEnum(SprintStatus)
  @IsOptional()
  status?: SprintStatus;
}
