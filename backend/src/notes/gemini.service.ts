import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface ExtractedTask {
  title: string;
  projectTag: string;
  isDone: boolean;
  dueDate?: string; // YYYY-MM-DD
  assigneeName?: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'dummy_key' && apiKey.trim() !== '') {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.logger.log('GeminiService initialisé avec succès avec une clé d\'API.');
    } else {
      this.logger.warn('Clé d\'API GEMINI_API_KEY absente. Le mode extraction par IA sera désactivé.');
    }
  }

  /**
   * Indique si le service est disponible et configuré.
   */
  isAvailable(): boolean {
    return this.genAI !== null;
  }

  /**
   * Extrait des tâches structurées à partir d'un texte Markdown en utilisant Gemini.
   */
  async extractTasksFromText(content: string, referenceDate: Date): Promise<ExtractedTask[]> {
    if (!this.genAI) {
      return [];
    }

    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'array' as any,
            description: "Liste des tâches extraites du texte",
            items: {
              type: 'object' as any,
              properties: {
                title: {
                  type: 'string' as any,
                  description: "Titre propre de la tâche sans hashtags, sans tags de date ni mentions d'assignation.",
                },
                projectTag: {
                  type: 'string' as any,
                  description: "Nom du projet associé (taggé avec '#' dans le texte). Sans le symbole '#'. Si aucun tag n'est spécifié, utiliser 'Inbox'.",
                },
                isDone: {
                  type: 'boolean' as any,
                  description: "true si la tâche est cochée (ex: - [x] ou - [X]), false sinon (ex: - [ ]).",
                },
                dueDate: {
                  type: 'string' as any,
                  description: "Date limite de la tâche calculée au format YYYY-MM-DD en fonction du contexte de date de référence (ex: 'mardi prochain' ou '25 juin'). Laisser vide ou nul si aucune date n'est mentionnée.",
                },
                assigneeName: {
                  type: 'string' as any,
                  description: "Le nom d'utilisateur associé au tag @Nom (ex: 'gaetan' pour '@gaetan'). Sans le symbole '@'. Laisser vide ou nul si aucune assignation.",
                },
              },
              required: ['title', 'projectTag', 'isDone'],
            },
          },
        },
      });

      const formattedRefDate = referenceDate.toISOString().split('T')[0];
      const prompt = `
Analyse le document/note Markdown suivant pour en extraire TOUTES les lignes de tâches (les lignes commençant par "- [ ]" ou "- [x]").
Pour chaque tâche identifiée, extrais de manière structurée ses métadonnées.

Date de référence pour le calcul des dates relatives (ex: "demain", "vendredi prochain", "d'ici 3 jours") : ${formattedRefDate} (Aujourd'hui).

Exemples de calcul de date limite :
- Si la tâche contient "d'ici vendredi" et que aujourd'hui est lundi 2026-05-18, la dueDate sera "2026-05-22".
- Si la tâche contient "pour demain", la dueDate sera le lendemain de la date de référence.

Texte Markdown à analyser :
"""
${content}
"""
`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      this.logger.debug(`Réponse brute de Gemini: ${responseText}`);
      
      const tasks: ExtractedTask[] = JSON.parse(responseText);
      return tasks;
    } catch (error) {
      this.logger.error(`Erreur lors de l'extraction des tâches via Gemini: ${error.message}`, error.stack);
      throw error;
    }
  }
}
