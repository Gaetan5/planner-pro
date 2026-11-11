import { IsString, IsNotEmpty, IsOptional, IsISO8601, IsEnum, MaxLength } from 'class-validator';
import { DeliverableStatus } from '@prisma/client';

export class CreateDeliverableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  title!: string;

  @IsString()
  @IsOptional()
  @MaxLength(16_000)
  description?: string;

  @IsEnum(DeliverableStatus)
  @IsOptional()
  status?: DeliverableStatus;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;
}
