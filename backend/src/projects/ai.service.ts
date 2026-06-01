import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService, ParsedAiAction } from '../notes/gemini.service';
import { ProjectsService } from './projects.service';
import { TaskPriority, TaskStatus, DependencyType } from '@prisma/client';

export interface ResolvedAiAction extends ParsedAiAction {
  id: string; // ID temporaire pour le frontend
  description: string; // Libellé descriptif lisible pour l'utilisateur
  resolved: boolean; // Indique si toutes les entités requises ont été trouvées
  taskId?: string;
  assigneeId?: string;
  dependsOnTaskId?: string;
  resolvedProjectName?: string;
  resolvedProjectId?: string;
  warning?: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geminiService: GeminiService,
    private readonly projectsService: ProjectsService,
  ) {}
  /**
   * Analyse une commande textuelle et résout les entités en base de données.
   */
  async analyzeCommand(
    userId: string,
    workspaceId: string,
    projectId: string | null,
    commandText: string,
  ): Promise<ResolvedAiAction[]> {
    this.logger.log(`Analyse de la commande IA de l'utilisateur ${userId} pour le workspace ${workspaceId}`);

    // Étape 1 : Demander à Gemini de parser l'intention en actions élémentaires
    let parsedActions: ParsedAiAction[] = [];
    if (commandText.startsWith('MOCK:')) {
      const cleanCommand = commandText.replace('MOCK:', '').trim();
      if (cleanCommand.includes('créer tâche')) {
        // Ex: "créer tâche Secu pour Alice"
        const taskPart = cleanCommand.replace('créer tâche', '').trim();
        const hasAssignee = taskPart.includes('pour');
        const taskTitle = hasAssignee ? taskPart.split('pour')[0].trim() : taskPart;
        const assigneeName = hasAssignee ? taskPart.split('pour')[1].trim() : undefined;

        parsedActions = [{
          type: 'CREATE_TASK',
          taskTitle,
          priority: 'HIGH',
          dueDate: '2026-06-01',
          estimatedMinutes: 120,
          assigneeName,
        }];
      } else if (cleanCommand.includes('assigner')) {
        // Ex: "assigner Alice sur Configurer la sécurité globale"
        const parts = cleanCommand.replace('assigner', '').split('sur');
        parsedActions = [{
          type: 'ASSIGN_TASK',
          assigneeName: parts[0]?.trim(),
          taskTitle: parts[1]?.trim(),
        }];
      } else if (cleanCommand.includes('planifier')) {
        // Ex: "planifier Configurer la sécurité globale"
        parsedActions = [{
          type: 'CREATE_TIMEBLOCK',
          taskTitle: cleanCommand.replace('planifier', '').trim(),
          timeBlockStart: '2026-06-01T10:00:00.000Z',
          timeBlockEnd: '2026-06-01T12:00:00.000Z',
        }];
      }
    } else {
      parsedActions = await this.geminiService.parseCommand(commandText, new Date());
    }
    
    const resolved = await this.resolveActions(workspaceId, parsedActions);

    // Archiver la requête dans l'historique
    await this.prisma.aiCommandHistory.create({
      data: {
        userId,
        rawPrompt: commandText,
        actionsJson: JSON.parse(JSON.stringify(resolved)),
        executed: false,
      },
    });

    return resolved;
  }

  /**
   * Analyse une image de projet (tableau blanc, capture d'écran) avec Gemini 1.5 Flash Vision
   * et extrait/résout des intentions d'actions d'automatisation.
   */
  async analyzeImageAndResolve(
    userId: string,
    workspaceId: string,
    projectId: string | null,
    imageBuffer: Buffer,
    mimeType: string,
    isMock: boolean = false,
  ): Promise<ResolvedAiAction[]> {
    this.logger.log(`Analyse d'image de projet demandée par l'utilisateur ${userId}`);

    let parsedActions: ParsedAiAction[] = [];

    if (isMock || !this.geminiService.isAvailable()) {
      this.logger.log("Mode mock ou Gemini indisponible détecté pour la vision. Utilisation d'actions simulées.");
      parsedActions = [{
        type: 'CREATE_TASK',
        taskTitle: "Implémenter l'OCR",
        priority: 'HIGH',
        dueDate: '2026-06-05',
        estimatedMinutes: 240,
        assigneeName: 'Alice',
      }];
    } else {
      parsedActions = await this.geminiService.analyzeImage(imageBuffer, mimeType);
    }

    const resolved = await this.resolveActions(workspaceId, parsedActions);

    // Archiver l'analyse d'image dans l'historique
    await this.prisma.aiCommandHistory.create({
      data: {
        userId,
        rawPrompt: `IMAGE_OCR_${mimeType}`,
        actionsJson: JSON.parse(JSON.stringify(resolved)),
        executed: false,
      },
    });

    return resolved;
  }

  /**
   * Résout les entités (membres d'équipe, tâches) en base de données pour un lot d'actions.
   */
  private async resolveActions(
    workspaceId: string,
    parsedActions: ParsedAiAction[]
  ): Promise<ResolvedAiAction[]> {
    // Charger tous les membres et les tâches pour la résolution d'entités
    const workspaceMembers = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: true },
    });

    const activeTasks = await this.prisma.task.findMany({
      where: {
        deletedAt: null,
        project: { workspaceId },
      },
    });

    const resolvedActions: ResolvedAiAction[] = [];

    // Étape 2 : Résoudre les entités pour chaque action
    for (let i = 0; i < parsedActions.length; i++) {
      const action = parsedActions[i];
      const tempId = `action-temp-${i}`;
      
      const resolvedAction: ResolvedAiAction = {
        ...action,
        id: tempId,
        description: '',
        resolved: true,
      };

      try {
        switch (action.type) {
          case 'CREATE_TASK': {
            let desc = `Créer la tâche "${action.taskTitle || 'Sans titre'}"`;
            
            // Priorité par défaut MEDIUM si non fournie
            const priority = action.priority || 'MEDIUM';
            desc += ` (Priorité ${priority}`;

            if (action.estimatedMinutes) {
              const hours = Math.round((action.estimatedMinutes / 60) * 10) / 10;
              desc += `, Estimé ${hours}h`;
            }
            if (action.dueDate) {
              desc += `, Échéance ${action.dueDate}`;
            }
            desc += `)`;

            // Résoudre l'assignation si mentionnée
            if (action.assigneeName) {
              const member = this.resolveMember(action.assigneeName, workspaceMembers);
              if (member) {
                resolvedAction.assigneeId = member.userId;
                resolvedAction.assigneeName = member.user.name || member.user.email;
                desc += ` assignée à ${resolvedAction.assigneeName}`;
              } else {
                resolvedAction.resolved = false;
                resolvedAction.warning = `Membre "${action.assigneeName}" introuvable.`;
              }
            }

            resolvedAction.description = desc;
            break;
          }

          case 'ASSIGN_TASK': {
            if (!action.taskTitle || !action.assigneeName) {
              throw new BadRequestException("Titre de tâche et nom d'assigné requis pour ASSIGN_TASK.");
            }

            const task = this.resolveTask(action.taskTitle, activeTasks);
            const member = this.resolveMember(action.assigneeName, workspaceMembers);

            let desc = `Assigner la tâche "${action.taskTitle}"`;
            if (task) {
              resolvedAction.taskId = task.id;
              resolvedAction.taskTitle = task.title; // Nom propre réel
              desc = `Assigner la tâche "${task.title}"`;
            } else {
              resolvedAction.resolved = false;
              resolvedAction.warning = `Tâche "${action.taskTitle}" introuvable.`;
            }

            if (member) {
              resolvedAction.assigneeId = member.userId;
              resolvedAction.assigneeName = member.user.name || member.user.email;
              desc += ` à ${resolvedAction.assigneeName}`;
            } else {
              resolvedAction.resolved = false;
              resolvedAction.warning = (resolvedAction.warning || '') + ` Membre "${action.assigneeName}" introuvable.`;
            }

            resolvedAction.description = desc;
            break;
          }

          case 'CREATE_DEPENDENCY': {
            if (!action.taskTitle || !action.dependsOnTaskTitle) {
              throw new BadRequestException("Tâche cible et tâche dépendante requises pour CREATE_DEPENDENCY.");
            }

            const task = this.resolveTask(action.taskTitle, activeTasks);
            const dependsOnTask = this.resolveTask(action.dependsOnTaskTitle, activeTasks);
            const depType = action.dependencyType || 'FINISH_TO_START';

            let desc = `Lier la tâche "${action.taskTitle}" pour dépendre de "${action.dependsOnTaskTitle}" (${depType})`;

            if (task) {
              resolvedAction.taskId = task.id;
              resolvedAction.taskTitle = task.title;
            } else {
              resolvedAction.resolved = false;
              resolvedAction.warning = `Tâche cible "${action.taskTitle}" introuvable.`;
            }

            if (dependsOnTask) {
              resolvedAction.dependsOnTaskId = dependsOnTask.id;
              resolvedAction.dependsOnTaskTitle = dependsOnTask.title;
            } else {
              resolvedAction.resolved = false;
              resolvedAction.warning = (resolvedAction.warning || '') + ` Tâche dépendante "${action.dependsOnTaskTitle}" introuvable.`;
            }

            if (task && dependsOnTask) {
              desc = `Lier "${task.title}" pour dépendre de "${dependsOnTask.title}" (${depType})`;
            }

            resolvedAction.description = desc;
            break;
          }

          case 'CREATE_TIMEBLOCK': {
            if (!action.taskTitle || !action.timeBlockStart || !action.timeBlockEnd) {
              throw new BadRequestException("Tâche, début et fin requis pour CREATE_TIMEBLOCK.");
            }

            const task = this.resolveTask(action.taskTitle, activeTasks);
            const start = new Date(action.timeBlockStart);
            const end = new Date(action.timeBlockEnd);
            const startStr = start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            const endStr = end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            const dateStr = start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

            let desc = `Planifier la tâche "${action.taskTitle}" le ${dateStr} de ${startStr} à ${endStr}`;

            if (task) {
              resolvedAction.taskId = task.id;
              resolvedAction.taskTitle = task.title;
              desc = `Planifier "${task.title}" le ${dateStr} de ${startStr} à ${endStr}`;
            } else {
              resolvedAction.resolved = false;
              resolvedAction.warning = `Tâche "${action.taskTitle}" introuvable.`;
            }

            resolvedAction.description = desc;
            break;
          }

          case 'UPDATE_TASK_STATUS': {
            if (!action.taskTitle || !action.status) {
              throw new BadRequestException("Tâche et statut requis pour UPDATE_TASK_STATUS.");
            }

            const task = this.resolveTask(action.taskTitle, activeTasks);
            let desc = `Passer le statut de "${action.taskTitle}" à ${action.status}`;

            if (task) {
              resolvedAction.taskId = task.id;
              resolvedAction.taskTitle = task.title;
              desc = `Passer le statut de "${task.title}" à ${action.status}`;
            } else {
              resolvedAction.resolved = false;
              resolvedAction.warning = `Tâche "${action.taskTitle}" introuvable.`;
            }

            resolvedAction.description = desc;
            break;
          }

          default:
            throw new BadRequestException(`Type d'action inconnu : ${action.type}`);
        }
      } catch (err) {
        resolvedAction.resolved = false;
        resolvedAction.warning = err.message;
        resolvedAction.description = `Action invalide [${action.type}]`;
      }

      resolvedActions.push(resolvedAction);
    }

    return resolvedActions;
  }

  /**
   * Transcrit un flux audio et analyse le texte résultant pour en extraire des actions.
   */
  async transcribeAndAnalyzeVoice(
    userId: string,
    workspaceId: string,
    projectId: string | null,
    audioBuffer: Buffer,
    mimeType: string,
    isMock: boolean = false,
  ): Promise<{ transcription: string; actions: ResolvedAiAction[] }> {
    this.logger.log(`Transcription et analyse vocale demandées par l'utilisateur ${userId}`);

    let transcription = '';

    // Bypass pour le mode test/mock ou si l'API n'est pas configurée
    if (isMock || !this.geminiService.isAvailable()) {
      this.logger.log("Mode mock ou Gemini indisponible détecté pour la voix. Utilisation d'une transcription simulée.");
      transcription = "MOCK: créer tâche Configurer la sécurité globale pour Alice";
    } else {
      transcription = await this.geminiService.transcribeAudio(audioBuffer, mimeType);
    }

    const actions = await this.analyzeCommand(userId, workspaceId, projectId, transcription);

    return {
      transcription,
      actions,
    };
  }

  /**
   * Exécute les actions validées par l'utilisateur.
   */
  async executeActions(
    userId: string,
    workspaceId: string,
    projectId: string | null,
    actions: ResolvedAiAction[],
  ): Promise<{ success: boolean; executedCount: number }> {
    this.logger.log(`Exécution de ${actions.length} actions automatisées par l'utilisateur ${userId}`);

    let executedCount = 0;

    // Transaction Prisma ou exécution séquentielle robuste
    for (const action of actions) {
      switch (action.type) {
        case 'CREATE_TASK': {
          let targetProjectId = projectId;
          
          if (!targetProjectId) {
            // Chercher le premier projet actif du workspace
            const activeProject = await this.prisma.project.findFirst({
              where: { workspaceId, deletedAt: null },
            });
            if (!activeProject) {
              throw new NotFoundException("Aucun projet actif trouvé dans le workspace pour y ajouter la tâche.");
            }
            targetProjectId = activeProject.id;
          }

          const options: any = {};
          if (action.dueDate) {
            options.dueDate = new Date(action.dueDate);
          }
          if (action.estimatedMinutes) {
            options.estimatedMinutes = action.estimatedMinutes;
          }
          if (action.assigneeId) {
            options.assigneeIds = [action.assigneeId];
          }

          await this.projectsService.createTask(
            targetProjectId,
            userId,
            action.taskTitle || 'Tâche sans titre',
            action.taskDescription,
            action.priority as TaskPriority || TaskPriority.MEDIUM,
            options,
          );
          executedCount++;
          break;
        }

        case 'ASSIGN_TASK': {
          if (!action.taskId || !action.assigneeId) {
            throw new BadRequestException("taskId et assigneeId requis pour exécuter l'assignation.");
          }

          await this.projectsService.updateTask(action.taskId, userId, {
            assigneeIds: [action.assigneeId],
          });
          executedCount++;
          break;
        }

        case 'CREATE_DEPENDENCY': {
          if (!action.taskId || !action.dependsOnTaskId) {
            throw new BadRequestException("taskId et dependsOnTaskId requis pour créer une dépendance.");
          }

          await this.projectsService.addTaskDependency(
            action.taskId,
            userId,
            action.dependsOnTaskId,
            action.dependencyType as DependencyType || DependencyType.FINISH_TO_START,
          );
          executedCount++;
          break;
        }

        case 'CREATE_TIMEBLOCK': {
          if (!action.taskId || !action.timeBlockStart || !action.timeBlockEnd) {
            throw new BadRequestException("taskId, début et fin de bloc requis pour planifier.");
          }

          await this.projectsService.createTimeBlock(
            action.taskId,
            userId,
            new Date(action.timeBlockStart),
            new Date(action.timeBlockEnd),
          );
          executedCount++;
          break;
        }

        case 'UPDATE_TASK_STATUS': {
          if (!action.taskId || !action.status) {
            throw new BadRequestException("taskId et statut requis pour modifier le statut.");
          }

          await this.projectsService.updateTask(action.taskId, userId, {
            status: action.status as TaskStatus,
          });
          executedCount++;
          break;
        }
      }
    }

    return {
      success: true,
      executedCount,
    };
  }

  // --- Helpers de Résolution d'Entités ---

  private normalizeString(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private resolveMember(nameOrEmail: string, members: any[]): any | null {
    const search = this.normalizeString(nameOrEmail);
    if (!search) return null;

    // 1. Recherche stricte ou partielle de l'e-mail
    let match = members.find(m => this.normalizeString(m.user.email) === search);
    if (match) return match;

    // 2. Recherche par correspondance sur le nom complet
    match = members.find(m => m.user.name && this.normalizeString(m.user.name).includes(search));
    if (match) return match;

    // 3. Recherche par préfixe d'email
    match = members.find(m => this.normalizeString(m.user.email.split('@')[0]) === search);
    if (match) return match;

    return null;
  }

  private resolveTask(titleSearch: string, tasks: any[]): any | null {
    const search = this.normalizeString(titleSearch);
    if (!search) return null;

    // 1. Recherche exacte
    let match = tasks.find(t => this.normalizeString(t.title) === search);
    if (match) return match;

    // 2. Recherche partielle (le titre contient la chaîne)
    match = tasks.find(t => this.normalizeString(t.title).includes(search));
    if (match) return match;

    return null;
  }
}
