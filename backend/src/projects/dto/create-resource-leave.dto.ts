import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateResourceLeaveDto {
  @IsISO8601()
  @IsNotEmpty()
  startDate!: string;

  @IsISO8601()
  @IsNotEmpty()
  endDate!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
