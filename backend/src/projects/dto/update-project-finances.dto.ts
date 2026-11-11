import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { BILLING_TYPES } from './billing-types';

export class UpdateProjectFinancesDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  budgetCents?: number;

  @IsIn(BILLING_TYPES)
  @IsOptional()
  billingType?: (typeof BILLING_TYPES)[number];
}
