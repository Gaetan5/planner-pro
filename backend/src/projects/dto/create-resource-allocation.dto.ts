import { IsString, IsNotEmpty, IsOptional, IsISO8601, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateResourceAllocationDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  allocationPercent: number;

  @IsString()
  @IsOptional()
  roleLabel?: string;

  @IsISO8601()
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @IsOptional()
  endDate?: string;
}
