import { IsString, IsOptional, IsArray, MaxLength, ArrayMaxSize } from 'class-validator';

export class CreateDeliveryDto {
  @IsString()
  @IsOptional()
  @MaxLength(16_000)
  summary?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(100)
  @MaxLength(191, { each: true })
  checklist?: string[];
}
