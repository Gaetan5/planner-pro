import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AiCommandDto {
  @IsString()
  @IsNotEmpty()
  command!: string;

  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsOptional()
  projectId?: string;
}
