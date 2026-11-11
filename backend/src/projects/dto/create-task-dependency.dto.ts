import { IsString, IsNotEmpty, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { DependencyType } from '@prisma/client';

export class CreateTaskDependencyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  dependsOnTaskId!: string;

  @IsEnum(DependencyType)
  @IsOptional()
  type?: DependencyType;
}
