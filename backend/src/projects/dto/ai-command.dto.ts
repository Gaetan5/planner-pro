import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class AiCommandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  command!: string;

  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsOptional()
  projectId?: string;
}
