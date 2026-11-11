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

/**
 * Longueurs maximales des champs texte d'une action IA résolue : source unique du DTO et de
 * `normalizeResolvedAction` (N5), pour que l'aperçu ne produise jamais une action que
 * l'exécution refuse. 64 : identifiants et dates ; 191 : titres et noms (colonnes VARCHAR(191)) ;
 * 2 000 : libellés ; 16 000 : description de tâche (colonne TEXT).
 */
export const RESOLVED_ACTION_MAX_LENGTH = {
  id: 64,
  description: 2000,
  taskId: 64,
  assigneeId: 64,
  dependsOnTaskId: 64,
  resolvedProjectName: 191,
  resolvedProjectId: 64,
  warning: 2000,
  taskTitle: 191,
  taskDescription: 16_000,
  dueDate: 64,
  assigneeName: 191,
  dependsOnTaskTitle: 191,
  timeBlockStart: 64,
  timeBlockEnd: 64,
} as const;

/** Action IA résolue, telle que renvoyée par `analyzeCommand` puis validée par l'utilisateur. */
export class ResolvedAiActionDto {
  @IsIn(AI_ACTION_TYPES)
  type!: (typeof AI_ACTION_TYPES)[number];

  @IsString() @IsOptional() @MaxLength(RESOLVED_ACTION_MAX_LENGTH.id) id?: string;
  @IsString() @IsOptional() @MaxLength(RESOLVED_ACTION_MAX_LENGTH.description) description?: string;
  @IsBoolean() @IsOptional() resolved?: boolean;
  @IsString() @IsOptional() @MaxLength(RESOLVED_ACTION_MAX_LENGTH.taskId) taskId?: string;
  @IsString() @IsOptional() @MaxLength(RESOLVED_ACTION_MAX_LENGTH.assigneeId) assigneeId?: string;
  @IsString()
  @IsOptional()
  @MaxLength(RESOLVED_ACTION_MAX_LENGTH.dependsOnTaskId)
  dependsOnTaskId?: string;
  @IsString()
  @IsOptional()
  @MaxLength(RESOLVED_ACTION_MAX_LENGTH.resolvedProjectName)
  resolvedProjectName?: string;
  @IsString()
  @IsOptional()
  @MaxLength(RESOLVED_ACTION_MAX_LENGTH.resolvedProjectId)
  resolvedProjectId?: string;
  @IsString() @IsOptional() @MaxLength(RESOLVED_ACTION_MAX_LENGTH.warning) warning?: string;
  @IsString() @IsOptional() @MaxLength(RESOLVED_ACTION_MAX_LENGTH.taskTitle) taskTitle?: string;
  @IsString()
  @IsOptional()
  @MaxLength(RESOLVED_ACTION_MAX_LENGTH.taskDescription)
  taskDescription?: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH']) @IsOptional() priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  @IsString() @IsOptional() @MaxLength(RESOLVED_ACTION_MAX_LENGTH.dueDate) dueDate?: string;
  @IsInt() @Min(0) @Max(100000) @IsOptional() estimatedMinutes?: number;
  @IsString()
  @IsOptional()
  @MaxLength(RESOLVED_ACTION_MAX_LENGTH.assigneeName)
  assigneeName?: string;
  @IsString()
  @IsOptional()
  @MaxLength(RESOLVED_ACTION_MAX_LENGTH.dependsOnTaskTitle)
  dependsOnTaskTitle?: string;
  @IsIn(['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH'])
  @IsOptional()
  dependencyType?: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH';
  @IsString()
  @IsOptional()
  @MaxLength(RESOLVED_ACTION_MAX_LENGTH.timeBlockStart)
  timeBlockStart?: string;
  @IsString()
  @IsOptional()
  @MaxLength(RESOLVED_ACTION_MAX_LENGTH.timeBlockEnd)
  timeBlockEnd?: string;
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
