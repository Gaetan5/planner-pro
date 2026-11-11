import { IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateResourceProfileDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  weeklyCapacityMinutes?: number;

  @IsString()
  @IsOptional()
  @MaxLength(16_000)
  skills?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  costRateCents?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  billingRateCents?: number;
}
