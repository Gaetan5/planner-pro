import { IsISO8601, IsNotEmpty } from 'class-validator';

export class CreateTimeBlockDto {
  @IsISO8601()
  @IsNotEmpty()
  startTime: string;

  @IsISO8601()
  @IsNotEmpty()
  endTime: string;
}
