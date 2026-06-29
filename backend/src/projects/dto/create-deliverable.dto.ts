import { IsString, IsNotEmpty, IsOptional, IsISO8601, IsEnum } from 'class-validator';
import { DeliverableStatus } from '@prisma/client';

export class CreateDeliverableDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(DeliverableStatus)
  @IsOptional()
  status?: DeliverableStatus;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;
}
