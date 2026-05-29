import { IsString, IsNotEmpty, IsOptional, IsISO8601 } from 'class-validator';

export class CreateMilestoneDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;
}
