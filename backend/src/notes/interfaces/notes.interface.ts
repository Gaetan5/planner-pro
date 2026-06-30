import { TaskStatus } from '@prisma/client';

export interface ParsedAiTask {
  title: string;
  dueDate?: string;
  estimatedMinutes?: number;
  assigneeName?: string;
}

export interface TaskStatusChange {
  taskId: string;
  status: TaskStatus;
}
