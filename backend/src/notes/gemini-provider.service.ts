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
      this.logger.log('GeminiProvider initialisé avec succès.');
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

      const formattedRefDate = referenceDate.toISOString().split('T')[0];
      const prompt = `
Analyse le document Markdown suivant pour en extraire TOUTES les lignes de tâches.
Date de référence : ${formattedRefDate}.
Texte Markdown :
"""
${content}
"""
`;
      const result = await model.generateContent(prompt);
      return JSON.parse(result.response.text());
    } catch (error) {
      this.logger.error(`Erreur d'extraction tâches: ${error}`);
      throw error;
    }
  }

  async parseCommand(content: string, referenceDate: Date): Promise<ParsedAiAction[]> {
    if (!this.genAI) return [];

    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object' as any,
            properties: {
              actions: {
                type: 'array' as any,
                items: {
                  type: 'object' as any,
                  properties: {
                    type: {
                      type: 'string' as any,
                      enum: [
                        'CREATE_TASK',
                        'ASSIGN_TASK',
                        'CREATE_DEPENDENCY',
                        'CREATE_TIMEBLOCK',
                        'UPDATE_TASK_STATUS',
                      ],
                    },
                    taskTitle: { type: 'string' as any },
                    taskDescription: { type: 'string' as any },
                    priority: { type: 'string' as any, enum: ['LOW', 'MEDIUM', 'HIGH'] },
                    dueDate: { type: 'string' as any },
                    estimatedMinutes: { type: 'number' as any },
                    assigneeName: { type: 'string' as any },
                    dependsOnTaskTitle: { type: 'string' as any },
                    dependencyType: {
                      type: 'string' as any,
                      enum: ['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH'],
                    },
                    timeBlockStart: { type: 'string' as any },
                    timeBlockEnd: { type: 'string' as any },
                    status: { type: 'string' as any, enum: ['TODO', 'IN_PROGRESS', 'DONE'] },
                  },
                  required: ['type'],
                },
              },
            },
            required: ['actions'],
          },
        },
      });

      const result = await model.generateContent(`Analyse la commande : ${content}`);
      return JSON.parse(result.response.text()).actions || [];
    } catch (error) {
      this.logger.error(`Erreur parseCommand: ${error}`);
      throw error;
    }
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    if (!this.genAI) throw new Error('Service non configuré');

    const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const response = await model.generateContent([
      { inlineData: { data: audioBuffer.toString('base64'), mimeType: mimeType } },
      'Transcris en français.',
    ]);
    return response.response.text().trim();
  }

  async analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<ParsedAiAction[]> {
    if (!this.genAI) throw new Error('Service non configuré');

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object' as any,
          properties: {
            actions: { type: 'array' as any, items: { type: 'object' as any } },
          },
          required: ['actions'],
        },
      },
    });

    const response = await model.generateContent([
      { inlineData: { data: imageBuffer.toString('base64'), mimeType: mimeType } },
      "Analyse cette image pour extraire des actions d'automatisation JSON.",
    ]);
    return JSON.parse(response.response.text()).actions || [];
  }
}
