import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsISO8601,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateResourceAllocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  allocationPercent!: number;

  @IsString()
  @IsOptional()
  @MaxLength(191)
  roleLabel?: string;

  @IsISO8601()
  @MaxLength(64)
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @MaxLength(64)
  @IsOptional()
  endDate?: string;
}
