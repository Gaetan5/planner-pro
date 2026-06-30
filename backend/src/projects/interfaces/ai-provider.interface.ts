export interface ExtractedTask {
  title: string;
  projectTag: string;
  isDone: boolean;
  dueDate?: string;
  assigneeName?: string;
}

export interface ParsedAiAction {
  type:
    'CREATE_TASK' | 'ASSIGN_TASK' | 'CREATE_DEPENDENCY' | 'CREATE_TIMEBLOCK' | 'UPDATE_TASK_STATUS';
  taskTitle?: string;
  taskDescription?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  dueDate?: string; // YYYY-MM-DD
  estimatedMinutes?: number;
  assigneeName?: string;
  dependsOnTaskTitle?: string;
  dependencyType?: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH';
  timeBlockStart?: string; // ISO
  timeBlockEnd?: string; // ISO
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE';
}

export interface AiProvider {
  isAvailable(): boolean;
  extractTasksFromText(content: string, referenceDate: Date): Promise<ExtractedTask[]>;
  parseCommand(content: string, referenceDate: Date): Promise<ParsedAiAction[]>;
  transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string>;
  analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<ParsedAiAction[]>;
}
