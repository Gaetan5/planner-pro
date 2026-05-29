import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateDeliveryDto {
  @IsString()
  @IsOptional()
  summary?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  checklist?: string[];
}
