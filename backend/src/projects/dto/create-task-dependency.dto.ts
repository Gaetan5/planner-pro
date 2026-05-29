import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { DependencyType } from '@prisma/client';

export class CreateTaskDependencyDto {
  @IsString()
  @IsNotEmpty()
  dependsOnTaskId: string;

  @IsEnum(DependencyType)
  @IsOptional()
  type?: DependencyType;
}
