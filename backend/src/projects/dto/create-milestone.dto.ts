import { IsString, IsNotEmpty, IsOptional, IsISO8601, MaxLength } from 'class-validator';

export class CreateMilestoneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(16_000)
  description?: string;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;
}
