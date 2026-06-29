import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface ExtractedTask {
  title: string;
  projectTag: string;
  isDone: boolean;
  dueDate?: string; // YYYY-MM-DD
  assigneeName?: string;
}

export interface ParsedAiAction {
  type: 'CREATE_TASK' | 'ASSIGN_TASK' | 'CREATE_DEPENDENCY' | 'CREATE_TIMEBLOCK' | 'UPDATE_TASK_STATUS';
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
   * Retourne l'instance du modèle de génération de contenu.
   */
  getGenerativeModel(config?: { model: string }) {
    if (!this.genAI) {
      throw new Error("L'API Gemini n'est pas initialisée.");
    }
    return this.genAI.getGenerativeModel({ model: config?.model || 'gemini-1.5-flash' });
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
    } catch (error: unknown) {
      this.logger.error(`Erreur lors de l'extraction des tâches via Gemini: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  /**
   * Analyse une commande en langage naturel et extrait les actions d'automatisation structurées.
   */
  async parseCommand(content: string, referenceDate: Date): Promise<ParsedAiAction[]> {
    if (!this.genAI) {
      return [];
    }

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
                description: "Liste des actions d'automatisation identifiées à partir de la commande en langage naturel.",
                items: {
                  type: 'object' as any,
                  properties: {
                    type: {
                      type: 'string' as any,
                      enum: ['CREATE_TASK', 'ASSIGN_TASK', 'CREATE_DEPENDENCY', 'CREATE_TIMEBLOCK', 'UPDATE_TASK_STATUS'],
                      description: "Le type de l'action à exécuter."
                    },
                    taskTitle: {
                      type: 'string' as any,
                      description: "Le titre de la tâche ciblée. Requis pour toutes les actions sauf CREATE_TASK si aucun titre n'est défini. Pour CREATE_TASK, c'est le titre de la nouvelle tâche."
                    },
                    taskDescription: {
                      type: 'string' as any,
                      description: "Description de la tâche (optionnel, utilisé pour CREATE_TASK)."
                    },
                    priority: {
                      type: 'string' as any,
                      enum: ['LOW', 'MEDIUM', 'HIGH'],
                      description: "La priorité de la tâche (pour CREATE_TASK)."
                    },
                    dueDate: {
                      type: 'string' as any,
                      description: "Date d'échéance calculée au format YYYY-MM-DD en se basant sur la date de référence. (pour CREATE_TASK)."
                    },
                    estimatedMinutes: {
                      type: 'number' as any,
                      description: "Temps estimé pour faire la tâche, en minutes (pour CREATE_TASK)."
                    },
                    assigneeName: {
                      type: 'string' as any,
                      description: "Nom, prénom ou email de l'utilisateur à assigner à la tâche (pour ASSIGN_TASK ou CREATE_TASK)."
                    },
                    dependsOnTaskTitle: {
                      type: 'string' as any,
                      description: "Le titre de la tâche dont dépend la tâche cible (requis pour CREATE_DEPENDENCY)."
                    },
                    dependencyType: {
                      type: 'string' as any,
                      enum: ['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH'],
                      description: "Le type de dépendance (pour CREATE_DEPENDENCY). Par défaut 'FINISH_TO_START'."
                    },
                    timeBlockStart: {
                      type: 'string' as any,
                      description: "Date et heure de début du créneau horaire au format ISO (ex: YYYY-MM-DDTHH:mm:ss) (pour CREATE_TIMEBLOCK)."
                    },
                    timeBlockEnd: {
                      type: 'string' as any,
                      description: "Date et heure de fin du créneau horaire au format ISO (ex: YYYY-MM-DDTHH:mm:ss) (pour CREATE_TIMEBLOCK)."
                    },
                    status: {
                      type: 'string' as any,
                      enum: ['TODO', 'IN_PROGRESS', 'DONE'],
                      description: "Le nouveau statut de la tâche (pour UPDATE_TASK_STATUS)."
                    }
                  },
                  required: ['type']
                }
              }
            },
            required: ['actions']
          }
        }
      });

      const formattedRefDate = referenceDate.toISOString().split('T')[0];
      const prompt = `
Analyse la commande en langage naturel suivante pour en extraire des actions d'automatisation structurées.
Date de référence pour le calcul des dates et heures relatives (ex: "demain à 14h", "vendredi prochain", "de 10h à 12h") : ${formattedRefDate} (Aujourd'hui).
Il est important de traduire précisément les mentions de temps relatives en dates/heures ISO complètes.

Exemples de commandes et de résultats attendus :
- "Créer une tâche sécurité pour demain estimée à 3 heures"
  -> Action: CREATE_TASK, taskTitle: "sécurité", dueDate: [date du lendemain], estimatedMinutes: 180
- "Assigne Gaëtan sur la tâche sécurité"
  -> Action: ASSIGN_TASK, taskTitle: "sécurité", assigneeName: "Gaëtan"
- "Bloque 2 heures demain matin de 10h à 12h pour la tâche sécurité"
  -> Action: CREATE_TIMEBLOCK, taskTitle: "sécurité", timeBlockStart: "[date du lendemain]T10:00:00", timeBlockEnd: "[date du lendemain]T12:00:00"
- "La tâche sécurité dépend de la tâche BDD"
  -> Action: CREATE_DEPENDENCY, taskTitle: "sécurité", dependsOnTaskTitle: "BDD", dependencyType: "FINISH_TO_START"
- "Passe la tâche sécurité à DONE"
  -> Action: UPDATE_TASK_STATUS, taskTitle: "sécurité", status: "DONE"

Commande utilisateur à analyser :
"""
${content}
"""
`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      this.logger.debug(`Réponse commande IA brute: ${responseText}`);
      
      const parsed = JSON.parse(responseText);
      return parsed.actions || [];
    } catch (error: unknown) {
      this.logger.error(`Erreur lors de l'analyse de la commande IA via Gemini: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  /**
   * Transcrit un fichier audio en français en utilisant Gemini 1.5 Flash.
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
    if (!this.genAI) {
      throw new Error("Le service Gemini n'est pas configuré (GEMINI_API_KEY manquante).");
    }

    try {
      this.logger.log(`Transcription audio demandée. Taille : ${audioBuffer.length} octets, Type : ${mimeType}`);
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const response = await model.generateContent([
        {
          inlineData: {
            data: audioBuffer.toString('base64'),
            mimeType: mimeType,
          },
        },
        "Transcris exactement cet enregistrement audio en français. Ne retourne rien d'autre que la transcription.",
      ]);

      const transcription = response.response.text();
      this.logger.log(`Transcription réussie : "${transcription.trim()}"`);
      return transcription.trim();
    } catch (error: unknown) {
      this.logger.error(`Erreur lors de la transcription audio via Gemini: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  /**
   * Analyse une image de projet (tableau blanc, capture d'écran) avec Gemini 1.5 Flash Vision
   * et extrait des intentions d'actions d'automatisation structurées.
   */
  async analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<ParsedAiAction[]> {
    if (!this.genAI) {
      throw new Error("Le service Gemini n'est pas configuré (GEMINI_API_KEY manquante).");
    }

    try {
      this.logger.log(`Analyse d'image demandée. Taille : ${imageBuffer.length} octets, Type : ${mimeType}`);
      
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object' as any,
            properties: {
              actions: {
                type: 'array' as any,
                description: "Liste des actions d'automatisation identifiées à partir de l'image.",
                items: {
                  type: 'object' as any,
                  properties: {
                    type: {
                      type: 'string' as any,
                      enum: ['CREATE_TASK', 'ASSIGN_TASK', 'CREATE_DEPENDENCY', 'CREATE_TIMEBLOCK', 'UPDATE_TASK_STATUS'],
                      description: "Le type de l'action à exécuter."
                    },
                    taskTitle: {
                      type: 'string' as any,
                      description: "Le titre de la tâche ciblée ou créée."
                    },
                    taskDescription: {
                      type: 'string' as any,
                      description: "Description optionnelle."
                    },
                    priority: {
                      type: 'string' as any,
                      enum: ['LOW', 'MEDIUM', 'HIGH'],
                      description: "La priorité (optionnel)."
                    },
                    dueDate: {
                      type: 'string' as any,
                      description: "Date d'échéance calculée au format YYYY-MM-DD (optionnel)."
                    },
                    estimatedMinutes: {
                      type: 'number' as any,
                      description: "Estimation en minutes (optionnel)."
                    },
                    assigneeName: {
                      type: 'string' as any,
                      description: "Nom de la personne à assigner (optionnel)."
                    },
                    dependsOnTaskTitle: {
                      type: 'string' as any,
                      description: "Titre de la tâche dont dépend la tâche cible (optionnel)."
                    },
                    dependencyType: {
                      type: 'string' as any,
                      enum: ['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH'],
                      description: "Le type de dépendance (optionnel)."
                    },
                    timeBlockStart: {
                      type: 'string' as any,
                      description: "Début du créneau au format ISO (optionnel)."
                    },
                    timeBlockEnd: {
                      type: 'string' as any,
                      description: "Fin du créneau au format ISO (optionnel)."
                    },
                    status: {
                      type: 'string' as any,
                      enum: ['TODO', 'IN_PROGRESS', 'DONE'],
                      description: "Nouveau statut (optionnel)."
                    }
                  },
                  required: ['type']
                }
              }
            },
            required: ['actions']
          }
        }
      });

      const response = await model.generateContent([
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: mimeType,
          },
        },
        "Analyse cette image de tableau blanc, schéma manuscrit ou capture d'écran de projet. Identifie toutes les tâches, assignations, créations de tâches, dépendances ou mises à jour de statut qui y figurent. Traduis ces informations en actions d'automatisation structurées en respectant strictement le format JSON demandé.",
      ]);

      const responseText = response.response.text();
      this.logger.debug(`Réponse vision brute de Gemini: ${responseText}`);
      
      const parsed = JSON.parse(responseText);
      return parsed.actions || [];
    } catch (error: unknown) {
      this.logger.error(`Erreur lors de l'analyse d'image via Gemini: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}
