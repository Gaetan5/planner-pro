import { IsISO8601, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateTimeBlockDto {
  @IsISO8601()
  @MaxLength(64)
  @IsNotEmpty()
  startTime!: string;

  @IsISO8601()
  @MaxLength(64)
  @IsNotEmpty()
  endTime!: string;
}
