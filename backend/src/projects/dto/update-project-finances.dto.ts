import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProjectFinancesDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  budgetCents?: number;

  @IsString()
  @IsOptional()
  billingType?: string;
}
