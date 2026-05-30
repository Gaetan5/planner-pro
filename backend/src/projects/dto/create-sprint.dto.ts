import { IsString, IsNotEmpty, IsOptional, IsEnum, IsISO8601 } from 'class-validator';
import { SprintStatus } from '@prisma/client';

export class CreateSprintDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsISO8601()
  @IsNotEmpty()
  startDate: string;

  @IsISO8601()
  @IsNotEmpty()
  endDate: string;

  @IsEnum(SprintStatus)
  @IsOptional()
  status?: SprintStatus;
}
