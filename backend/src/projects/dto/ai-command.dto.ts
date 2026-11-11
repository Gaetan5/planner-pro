import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class AiCommandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  command!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  workspaceId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  projectId?: string;
}
