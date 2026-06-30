import { ParsedAiAction } from '../../notes/gemini.service';
import { ExtractedTask } from '../../notes/gemini.service';

export interface AiProvider {
  isAvailable(): boolean;
  extractTasksFromText(content: string, referenceDate: Date): Promise<ExtractedTask[]>;
  parseCommand(content: string, referenceDate: Date): Promise<ParsedAiAction[]>;
  transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string>;
  analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<ParsedAiAction[]>;
}
