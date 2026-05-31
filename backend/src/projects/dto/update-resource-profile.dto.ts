import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateResourceProfileDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  weeklyCapacityMinutes?: number;

  @IsString()
  @IsOptional()
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
