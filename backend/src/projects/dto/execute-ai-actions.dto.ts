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

  @IsString() @IsOptional() id?: string;
  @IsString() @IsOptional() description?: string;
  @IsBoolean() @IsOptional() resolved?: boolean;
  @IsString() @IsOptional() taskId?: string;
  @IsString() @IsOptional() assigneeId?: string;
  @IsString() @IsOptional() dependsOnTaskId?: string;
  @IsString() @IsOptional() resolvedProjectName?: string;
  @IsString() @IsOptional() resolvedProjectId?: string;
  @IsString() @IsOptional() warning?: string;
  @IsString() @IsOptional() taskTitle?: string;
  @IsString() @IsOptional() taskDescription?: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH']) @IsOptional() priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  @IsString() @IsOptional() dueDate?: string;
  @IsInt() @Min(0) @Max(100000) @IsOptional() estimatedMinutes?: number;
  @IsString() @IsOptional() assigneeName?: string;
  @IsString() @IsOptional() dependsOnTaskTitle?: string;
  @IsIn(['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH'])
  @IsOptional()
  dependencyType?: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH';
  @IsString() @IsOptional() timeBlockStart?: string;
  @IsString() @IsOptional() timeBlockEnd?: string;
  @IsIn(['TODO', 'IN_PROGRESS', 'DONE']) @IsOptional() status?: 'TODO' | 'IN_PROGRESS' | 'DONE';
}

/** Corps de `POST /projects/ai/execute` (S15) : au plus 50 actions. */
export class ExecuteAiActionsDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResolvedAiActionDto)
  actions!: ResolvedAiActionDto[];
}
