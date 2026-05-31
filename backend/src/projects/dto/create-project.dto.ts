import { IsString, IsNotEmpty, IsOptional, IsEnum, IsISO8601, IsInt, Min } from 'class-validator';
import { ProjectStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
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
  billingType?: string;
}
