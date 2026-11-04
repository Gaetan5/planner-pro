import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PolicyService } from '../authz/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiProvider, ParsedAiAction } from '../projects/interfaces/ai-provider.interface';
import { CreateTaskDto } from './dto/create-task.dto';
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

/** Champs texte d'une `ResolvedAiAction` renvoyés au client (liste fermée, alignée sur le DTO). */
const RESOLVED_ACTION_TEXT_FIELDS = [
  'id',
  'description',
  'taskId',
  'assigneeId',
  'dependsOnTaskId',
  'resolvedProjectName',
  'resolvedProjectId',
  'warning',
  'taskTitle',
  'taskDescription',
  'priority',
  'dueDate',
  'assigneeName',
  'dependsOnTaskTitle',
  'dependencyType',
  'timeBlockStart',
  'timeBlockEnd',
  'status',
] as const;

/** Champs à valeurs énumérées (alignés sur `ExecuteAiActionsDto`) : toute autre valeur est retirée. */
const RESOLVED_ACTION_ENUM_FIELDS: Record<string, readonly string[]> = {
  priority: ['LOW', 'MEDIUM', 'HIGH'],
  status: ['TODO', 'IN_PROGRESS', 'DONE'],
  dependencyType: ['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH'],
};

/**
 * Normalise une action avant de la renvoyer au client, qui la renverra telle quelle à
 * `POST /projects/ai/execute` (DTO strict, décision 4) : seuls les champs connus, les valeurs
 * `null` retirées, `estimatedMinutes` arrondi à un entier borné. Un champ ou un type inattendu
 * renvoyé par le fournisseur d'IA ne peut ainsi jamais faire échouer l'exécution.
 */
export function normalizeResolvedAction(action: ResolvedAiAction): ResolvedAiAction {
  const source = action as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { type: action.type, resolved: action.resolved === true };
  for (const key of RESOLVED_ACTION_TEXT_FIELDS) {
    if (typeof source[key] !== 'string') continue;
    const allowed = RESOLVED_ACTION_ENUM_FIELDS[key];
    if (!allowed || allowed.includes(source[key] as string)) out[key] = source[key];
  }
  const minutes = source.estimatedMinutes;
  if (typeof minutes === 'number' && Number.isFinite(minutes)) {
    out.estimatedMinutes = Math.min(Math.max(Math.round(minutes), 0), 100000);
  }
  return out as unknown as ResolvedAiAction;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('AI_PROVIDER')
    private readonly geminiService: AiProvider,
    private readonly projectsService: ProjectsService,
    private readonly policy: PolicyService,
  ) {}

  /**
   * Contrôle d'accès commun à toutes les entrées IA (S15) : l'appelant doit pouvoir utiliser l'IA
   * dans ce workspace, et si un projet est visé, y écrire ET le projet doit appartenir au workspace.
   * Appelé AVANT toute lecture de membres ou de tâches et avant tout appel à Gemini.
   */
  private async authorize(userId: string, workspaceId: string, projectId: string | null) {
    await this.policy.assertWorkspace(workspaceId, userId, 'ai.use');
    if (projectId) {
      const project = await this.policy.assertProject(projectId, userId, 'task.write');
      if (project.workspaceId !== workspaceId) {
        throw new ForbiddenException('Le projet n’appartient pas à ce workspace.');
      }
    }
  }

  /**
   * Analyse une commande textuelle et résout les entités en base de données.
   */
  async analyzeCommand(
    userId: string,
    workspaceId: string,
    projectId: string | null,
    commandText: string,
  ): Promise<ResolvedAiAction[]> {
    await this.authorize(userId, workspaceId, projectId);
    return this.analyzeText(userId, workspaceId, commandText);
  }

  /** Analyse d'un texte pour un appelant DÉJÀ autorisé (voir `authorize`). */
  private async analyzeText(
    userId: string,
    workspaceId: string,
    commandText: string,
  ): Promise<ResolvedAiAction[]> {
    this.logger.log(
      `Analyse de la commande IA de l'utilisateur ${userId} pour le workspace ${workspaceId}`,
    );

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

        parsedActions = [
          {
            type: 'CREATE_TASK',
            taskTitle,
            priority: 'HIGH',
            dueDate: '2026-06-01',
            estimatedMinutes: 120,
            assigneeName,
          },
        ];
      } else if (cleanCommand.includes('assigner')) {
        // Ex: "assigner Alice sur Configurer la sécurité globale"
        const parts = cleanCommand.replace('assigner', '').split('sur');
        parsedActions = [
          {
            type: 'ASSIGN_TASK',
            assigneeName: parts[0]?.trim(),
            taskTitle: parts[1]?.trim(),
          },
        ];
      } else if (cleanCommand.includes('planifier')) {
        // Ex: "planifier Configurer la sécurité globale"
        parsedActions = [
          {
            type: 'CREATE_TIMEBLOCK',
            taskTitle: cleanCommand.replace('planifier', '').trim(),
            timeBlockStart: '2026-06-01T10:00:00.000Z',
            timeBlockEnd: '2026-06-01T12:00:00.000Z',
          },
        ];
      }
    } else {
      parsedActions = await this.geminiService.parseCommand(commandText, new Date());
    }

    const resolved = await this.resolveActions(userId, workspaceId, parsedActions);

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
    await this.authorize(userId, workspaceId, projectId);
    this.logger.log(`Analyse d'image de projet demandée par l'utilisateur ${userId}`);

    let parsedActions: ParsedAiAction[];

    if (isMock || !this.geminiService.isAvailable()) {
      this.logger.log(
        "Mode mock ou Gemini indisponible détecté pour la vision. Utilisation d'actions simulées.",
      );
      parsedActions = [
        {
          type: 'CREATE_TASK',
          taskTitle: "Implémenter l'OCR",
          priority: 'HIGH',
          dueDate: '2026-06-05',
          estimatedMinutes: 240,
          assigneeName: 'Alice',
        },
      ];
    } else {
      parsedActions = await this.geminiService.analyzeImage(imageBuffer, mimeType);
    }

    const resolved = await this.resolveActions(userId, workspaceId, parsedActions);

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
    userId: string,
    workspaceId: string,
    parsedActions: ParsedAiAction[],
  ): Promise<ResolvedAiAction[]> {
    // Les tâches résolues se limitent aux projets où l'appelant peut écrire (S12, S15)
    const writableProjectIds = await this.policy.listAccessibleProjectIds(userId, {
      workspaceId,
      action: 'task.write',
    });
    // Charger tous les membres et les tâches pour la résolution d'entités
    const workspaceMembers = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: true },
    });

    const activeTasks = await this.prisma.task.findMany({
      where: {
        deletedAt: null,
        project: { workspaceId },
        projectId: { in: writableProjectIds },
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
              throw new BadRequestException(
                "Titre de tâche et nom d'assigné requis pour ASSIGN_TASK.",
              );
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
              resolvedAction.warning =
                (resolvedAction.warning || '') + ` Membre "${action.assigneeName}" introuvable.`;
            }

            resolvedAction.description = desc;
            break;
          }

          case 'CREATE_DEPENDENCY': {
            if (!action.taskTitle || !action.dependsOnTaskTitle) {
              throw new BadRequestException(
                'Tâche cible et tâche dépendante requises pour CREATE_DEPENDENCY.',
              );
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
              resolvedAction.warning =
                (resolvedAction.warning || '') +
                ` Tâche dépendante "${action.dependsOnTaskTitle}" introuvable.`;
            }

            if (task && dependsOnTask) {
              desc = `Lier "${task.title}" pour dépendre de "${dependsOnTask.title}" (${depType})`;
            }

            resolvedAction.description = desc;
            break;
          }

          case 'CREATE_TIMEBLOCK': {
            if (!action.taskTitle || !action.timeBlockStart || !action.timeBlockEnd) {
              throw new BadRequestException('Tâche, début et fin requis pour CREATE_TIMEBLOCK.');
            }

            const task = this.resolveTask(action.taskTitle, activeTasks);
            const start = new Date(action.timeBlockStart);
            const end = new Date(action.timeBlockEnd);
            const startStr = start.toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            });
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
              throw new BadRequestException('Tâche et statut requis pour UPDATE_TASK_STATUS.');
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
      } catch (err: unknown) {
        resolvedAction.resolved = false;
        resolvedAction.warning =
          err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err);
        resolvedAction.description = `Action invalide [${action.type}]`;
      }

      resolvedActions.push(normalizeResolvedAction(resolvedAction));
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
    // Avant toute transcription : le quota Gemini ne sert que les membres habilités (S15)
    await this.authorize(userId, workspaceId, projectId);
    this.logger.log(`Transcription et analyse vocale demandées par l'utilisateur ${userId}`);

    let transcription: string;

    // Bypass pour le mode test/mock ou si l'API n'est pas configurée
    if (isMock || !this.geminiService.isAvailable()) {
      this.logger.log(
        "Mode mock ou Gemini indisponible détecté pour la voix. Utilisation d'une transcription simulée.",
      );
      transcription = 'MOCK: créer tâche Configurer la sécurité globale pour Alice';
    } else {
      transcription = await this.geminiService.transcribeAudio(audioBuffer, mimeType);
    }

    const actions = await this.analyzeText(userId, workspaceId, transcription);

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
  ): Promise<{ success: boolean; executedCount: number; changedTaskIds: string[] }> {
    await this.authorize(userId, workspaceId, projectId);
    this.logger.log(
      `Exécution de ${actions.length} actions automatisées par l'utilisateur ${userId}`,
    );

    let executedCount = 0;
    // Tâches réellement modifiées (et autorisées par les services) : seules à être diffusées
    const changedTaskIds = new Set<string>();

    // Transaction Prisma ou exécution séquentielle robuste
    for (const action of actions) {
      switch (action.type) {
        case 'CREATE_TASK': {
          let targetProjectId = projectId;

          if (!targetProjectId) {
            // Premier projet du workspace où l'appelant peut écrire (S15)
            const [firstWritable] = await this.policy.listAccessibleProjectIds(userId, {
              workspaceId,
              action: 'task.write',
            });
            if (!firstWritable) {
              throw new NotFoundException(
                'Aucun projet actif trouvé dans le workspace pour y ajouter la tâche.',
              );
            }
            targetProjectId = firstWritable;
          }

          const options: Partial<CreateTaskDto> = {};
          if (action.dueDate) {
            options.dueDate = action.dueDate;
          }
          if (action.estimatedMinutes) {
            options.estimatedMinutes = action.estimatedMinutes;
          }
          if (action.assigneeId) {
            options.assigneeIds = [action.assigneeId];
          }

          const created = await this.projectsService.createTask(
            targetProjectId,
            userId,
            action.taskTitle || 'Tâche sans titre',
            action.taskDescription,
            (action.priority as TaskPriority) || TaskPriority.MEDIUM,
            options,
          );
          if (created?.id) changedTaskIds.add(created.id);
          executedCount++;
          break;
        }

        case 'ASSIGN_TASK': {
          if (!action.taskId || !action.assigneeId) {
            throw new BadRequestException(
              "taskId et assigneeId requis pour exécuter l'assignation.",
            );
          }

          await this.projectsService.updateTask(action.taskId, userId, {
            assigneeIds: [action.assigneeId],
          });
          changedTaskIds.add(action.taskId);
          executedCount++;
          break;
        }

        case 'CREATE_DEPENDENCY': {
          if (!action.taskId || !action.dependsOnTaskId) {
            throw new BadRequestException(
              'taskId et dependsOnTaskId requis pour créer une dépendance.',
            );
          }

          await this.projectsService.addTaskDependency(
            action.taskId,
            userId,
            action.dependsOnTaskId,
            (action.dependencyType as DependencyType) || DependencyType.FINISH_TO_START,
          );
          changedTaskIds.add(action.taskId);
          executedCount++;
          break;
        }

        case 'CREATE_TIMEBLOCK': {
          if (!action.taskId || !action.timeBlockStart || !action.timeBlockEnd) {
            throw new BadRequestException('taskId, début et fin de bloc requis pour planifier.');
          }

          await this.projectsService.createTimeBlock(
            action.taskId,
            userId,
            new Date(action.timeBlockStart),
            new Date(action.timeBlockEnd),
          );
          changedTaskIds.add(action.taskId);
          executedCount++;
          break;
        }

        case 'UPDATE_TASK_STATUS': {
          if (!action.taskId || !action.status) {
            throw new BadRequestException('taskId et statut requis pour modifier le statut.');
          }

          await this.projectsService.updateTask(action.taskId, userId, {
            status: action.status as TaskStatus,
          });
          changedTaskIds.add(action.taskId);
          executedCount++;
          break;
        }
      }
    }

    return {
      success: true,
      executedCount,
      changedTaskIds: [...changedTaskIds],
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

  private resolveMember(
    nameOrEmail: string,
    members: { userId: string; user: { name: string | null; email: string } }[],
  ) {
    const search = this.normalizeString(nameOrEmail);
    if (!search) return null;

    // 1. Recherche stricte ou partielle de l'e-mail
    let match = members.find((m) => this.normalizeString(m.user.email) === search);
    if (match) return match;

    // 2. Recherche par correspondance sur le nom complet
    match = members.find((m) => m.user.name && this.normalizeString(m.user.name).includes(search));
    if (match) return match;

    // 3. Recherche par préfixe d'email
    match = members.find((m) => this.normalizeString(m.user.email.split('@')[0]) === search);
    if (match) return match;

    return null;
  }

  private resolveTask(titleSearch: string, tasks: { id: string; title: string }[]) {
    const search = this.normalizeString(titleSearch);
    if (!search) return null;

    // 1. Recherche exacte
    let match = tasks.find((t) => this.normalizeString(t.title) === search);
    if (match) return match;

    // 2. Recherche partielle (le titre contient la chaîne)
    match = tasks.find((t) => this.normalizeString(t.title).includes(search));
    if (match) return match;

    return null;
  }
}
