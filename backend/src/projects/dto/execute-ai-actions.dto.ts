import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
  MaxLength,
} from 'class-validator';

export const AI_ACTION_TYPES = [
  'CREATE_TASK',
  'ASSIGN_TASK',
  'CREATE_DEPENDENCY',
  'CREATE_TIMEBLOCK',
  'UPDATE_TASK_STATUS',
] as const;

/** Action IA résolue, telle que renvoyée par `analyzeCommand` puis validée par l'utilisateur. */
export class ResolvedAiActionDto {
  @IsIn(AI_ACTION_TYPES)
  type!: (typeof AI_ACTION_TYPES)[number];

  @IsString() @IsOptional() @MaxLength(64) id?: string;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
  @IsBoolean() @IsOptional() resolved?: boolean;
  @IsString() @IsOptional() @MaxLength(64) taskId?: string;
  @IsString() @IsOptional() @MaxLength(64) assigneeId?: string;
  @IsString() @IsOptional() @MaxLength(64) dependsOnTaskId?: string;
  @IsString() @IsOptional() @MaxLength(191) resolvedProjectName?: string;
  @IsString() @IsOptional() @MaxLength(64) resolvedProjectId?: string;
  @IsString() @IsOptional() @MaxLength(2000) warning?: string;
  @IsString() @IsOptional() @MaxLength(191) taskTitle?: string;
  @IsString() @IsOptional() @MaxLength(16_000) taskDescription?: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH']) @IsOptional() priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  @IsString() @IsOptional() @MaxLength(64) dueDate?: string;
  @IsInt() @Min(0) @Max(100000) @IsOptional() estimatedMinutes?: number;
  @IsString() @IsOptional() @MaxLength(191) assigneeName?: string;
  @IsString() @IsOptional() @MaxLength(191) dependsOnTaskTitle?: string;
  @IsIn(['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH'])
  @IsOptional()
  dependencyType?: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH';
  @IsString() @IsOptional() @MaxLength(64) timeBlockStart?: string;
  @IsString() @IsOptional() @MaxLength(64) timeBlockEnd?: string;
  @IsIn(['TODO', 'IN_PROGRESS', 'DONE']) @IsOptional() status?: 'TODO' | 'IN_PROGRESS' | 'DONE';
}

/** Corps de `POST /projects/ai/execute` (S15) : au plus 50 actions. */
export class ExecuteAiActionsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  workspaceId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  projectId?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResolvedAiActionDto)
  actions!: ResolvedAiActionDto[];
}
