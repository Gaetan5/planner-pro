import { IsString, IsNotEmpty, IsOptional, IsEnum, IsISO8601, IsInt, Min, Max, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { TaskPriority } from '@prisma/client';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

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
  estimatedMinutes?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  progress?: number;

  @IsString()
  @IsOptional()
  labels?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  assigneeIds?: string[];
}
