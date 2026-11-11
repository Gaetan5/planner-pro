import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttachmentDto, MAX_ATTACHMENTS_PER_COMMENT } from './attachment.dto';

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16_000)
  content!: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  parentId?: string;

  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_COMMENT)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  @IsOptional()
  attachments?: AttachmentDto[];
}
