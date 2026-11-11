import {
  IsString,
  IsOptional,
  IsEnum,
  IsISO8601,
  IsInt,
  Min,
  MaxLength,
  IsIn,
} from 'class-validator';
import { ProjectStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { BILLING_TYPES } from './billing-types';

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  @MaxLength(191)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(16_000)
  description?: string;

  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @IsISO8601()
  @MaxLength(64)
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @MaxLength(64)
  @IsOptional()
  dueDate?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  budgetCents?: number;

  @IsIn(BILLING_TYPES)
  @IsOptional()
  billingType?: (typeof BILLING_TYPES)[number];
}
