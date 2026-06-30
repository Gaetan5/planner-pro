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
    if (!this.genAI) return [];

    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'array' as any,
            description: 'Liste des tâches extraites du texte',
            items: {
              type: 'object' as any,
              properties: {
                title: { type: 'string' as any },
                projectTag: { type: 'string' as any },
                isDone: { type: 'boolean' as any },
                dueDate: { type: 'string' as any },
                assigneeName: { type: 'string' as any },
              },
              required: ['title', 'projectTag', 'isDone'],
            },
          },
        },
      });

      const prompt = `Analyse le document Markdown suivant... (Prompt identique à celui de GeminiService)`;
      const result = await model.generateContent(prompt);
      return JSON.parse(result.response.text());
    } catch (error) {
      this.logger.error(`Erreur d'extraction tâches: ${error}`);
      throw error;
    }
  }

  async parseCommand(content: string, referenceDate: Date): Promise<ParsedAiAction[]> {
    if (!this.genAI) return [];
    
    // ... implémentation déplacée depuis GeminiService
    return []; // À compléter avec la logique réelle
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    if (!this.genAI) throw new Error("Service non configuré");
    
    // ... implémentation déplacée depuis GeminiService
    return ''; // À compléter avec la logique réelle
  }

  async analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<ParsedAiAction[]> {
    if (!this.genAI) throw new Error("Service non configuré");
    
    // ... implémentation déplacée depuis GeminiService
    return []; // À compléter avec la logique réelle
  }
}
