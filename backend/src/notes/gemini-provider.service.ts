import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AiProvider } from '../projects/interfaces/ai-provider.interface';
import { ExtractedTask, ParsedAiAction } from './gemini.service';

@Injectable()
export class GeminiProvider implements AiProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'dummy_key' && apiKey.trim() !== '') {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.logger.log("GeminiProvider initialisé avec succès.");
    } else {
      this.logger.warn("Clé d'API GEMINI_API_KEY absente.");
    }
  }

  isAvailable(): boolean {
    return this.genAI !== null;
  }

  async extractTasksFromText(content: string, referenceDate: Date): Promise<ExtractedTask[]> {
    // ... implémentation déplacée depuis GeminiService
    return []; // À implémenter
  }

  async parseCommand(content: string, referenceDate: Date): Promise<ParsedAiAction[]> {
    // ... implémentation déplacée depuis GeminiService
    return []; // À implémenter
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    // ... implémentation déplacée depuis GeminiService
    return ''; // À implémenter
  }

  async analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<ParsedAiAction[]> {
    // ... implémentation déplacée depuis GeminiService
    return []; // À implémenter
  }
}
