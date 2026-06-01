import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsArray()
  @IsOptional()
  attachments?: { fileName: string; fileUrl: string; fileType: string; fileSize: number }[];
}
