import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsISO8601,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';
import { ProjectStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(16_000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  workspaceId?: string;

  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  budgetCents?: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  billingType?: string;
}
