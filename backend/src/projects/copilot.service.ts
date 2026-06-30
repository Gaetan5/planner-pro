import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../notes/gemini.service';

export interface PredictiveAlert {
  id: string;
  type: 'OVERDUE' | 'AT_RISK' | 'OVERLOADED' | 'BOTTLENECK';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  message: string;
  taskId?: string;
  taskTitle?: string;
  userId?: string;
  userName?: string;
}

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geminiService: GeminiService,
  ) {}

  /**
   * Calcule les alertes prédictives sur le workspace via un moteur de règles heuristiques.
   */
  async calculatePredictiveAlerts(workspaceId: string): Promise<PredictiveAlert[]> {
    this.logger.log(`Calcul des alertes prédictives pour le workspace ${workspaceId}`);
    const alerts: PredictiveAlert[] = [];

    // 1. Récupérer tous les projets et tâches actives (non terminées)
    const projects = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null },
      include: {
        tasks: {
          where: { deletedAt: null, status: { not: 'DONE' } },
          include: {
            assignees: { include: { user: true } },
            dependencies: {
              include: {
                dependsOnTask: true,
              },
            },
          },
        },
      },
    });

    const activeTasks = projects.flatMap((p) => p.tasks);

    // Date du jour sans les heures pour les comparaisons
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const formatLocalDate = (date: Date) => {
      return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    };

    // Indexer les tâches par ID pour faciliter les liaisons
    const tasksMap = new Map(activeTasks.map((t) => [t.id, t]));

    // Liste des IDs des tâches en retard pour la détection des blocages
    const overdueTaskIds = new Set<string>();
    const atRiskTaskIds = new Set<string>();

    // Règle 1 & 2 : Tâches en retard (Overdue) et à Risque (At Risk)
    for (const task of activeTasks) {
      if (task.dueDate) {
        const dueDate = new Date(task.dueDate);
        dueDate.setHours(0, 0, 0, 0);

        if (dueDate < today) {
          overdueTaskIds.add(task.id);
          alerts.push({
            id: `alert-overdue-${task.id}`,
            type: 'OVERDUE',
            severity: 'CRITICAL',
            message: `La tâche "${task.title}" est en retard depuis le ${formatLocalDate(dueDate)}.`,
            taskId: task.id,
            taskTitle: task.title,
          });
        } else {
          // Risque de retard : échéance dans les 3 jours et statut toujours TODO
          const diffTime = dueDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays <= 3 && task.status === 'TODO') {
            atRiskTaskIds.add(task.id);
            alerts.push({
              id: `alert-atrisk-${task.id}`,
              type: 'AT_RISK',
              severity: 'HIGH',
              message: `La tâche "${task.title}" arrive à échéance le ${formatLocalDate(dueDate)} mais n'a pas encore commencé.`,
              taskId: task.id,
              taskTitle: task.title,
            });
          }
        }
      }
    }

    // Règle 3 : Goulot d'étranglement (Blocked / Bottleneck)
    for (const task of activeTasks) {
      for (const dep of task.dependencies) {
        const isBlockingOverdue = overdueTaskIds.has(dep.dependsOnTaskId);
        const isBlockingAtRisk = atRiskTaskIds.has(dep.dependsOnTaskId);

        if (isBlockingOverdue || isBlockingAtRisk) {
          const blockingTask = dep.dependsOnTask;
          const statusReason = isBlockingOverdue ? 'en retard' : 'à risque';
          alerts.push({
            id: `alert-blocked-${task.id}-${dep.dependsOnTaskId}`,
            type: 'BOTTLENECK',
            severity: 'HIGH',
            message: `La tâche "${task.title}" est bloquée par "${blockingTask.title}" qui est ${statusReason}.`,
            taskId: task.id,
            taskTitle: task.title,
          });
          break; // Une seule alerte de blocage suffit
        }
      }
    }

    // Règle 4 : Collaborateur en surcharge (Overloaded)
    // Récupérer la capacité des profils du workspace
    const profiles = await this.prisma.resourceProfile.findMany({
      where: { workspaceId },
      include: { user: true },
    });

    const profilesMap = new Map(profiles.map((p) => [p.userId, p]));

    // Récupérer tous les membres actifs du workspace
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: true },
    });

    // Cumuler le temps estimé par utilisateur pour les tâches actives affectées
    const userMinutesMap = new Map<string, { minutes: number; name: string }>();

    for (const member of memberships) {
      userMinutesMap.set(member.userId, {
        minutes: 0,
        name: member.user.name || member.user.email,
      });
    }

    for (const task of activeTasks) {
      if (task.estimatedMinutes) {
        for (const assignee of task.assignees) {
          const current = userMinutesMap.get(assignee.userId);
          if (current) {
            current.minutes += task.estimatedMinutes;
          }
        }
      }
    }

    // Vérifier les surcharges (seuil hebdomadaire de surcharge)
    for (const [userId, data] of userMinutesMap.entries()) {
      const profile = profilesMap.get(userId);
      const capacity = profile ? profile.weeklyCapacityMinutes : 2400; // 40 heures par défaut

      if (data.minutes > capacity) {
        const hoursPlanned = (data.minutes / 60).toFixed(1);
        const hoursCapacity = (capacity / 60).toFixed(0);
        alerts.push({
          id: `alert-overload-${userId}`,
          type: 'OVERLOADED',
          severity: 'MEDIUM',
          message: `${data.name} est en surcharge de travail avec ${hoursPlanned} heures estimées sur ses tâches actives (capacité max conseillée : ${hoursCapacity}h/semaine).`,
          userId: userId,
          userName: data.name,
        });
      }
    }

    return alerts;
  }

  /**
   * Génère un briefing matinal dynamique en français basé sur l'IA (Gemini) ou un mock premium.
   */
  async generateBriefing(
    userId: string,
    workspaceId: string,
    isMock: boolean = false,
  ): Promise<string> {
    this.logger.log(`Génération du briefing matinal pour l'utilisateur ${userId}`);

    // 1. Récupérer les données de l'utilisateur et de sa charge
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    const userName = user?.name || 'Collaborateur';

    // 2. Charger les tâches actives affectées à cet utilisateur
    const assignedTasks = await this.prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { not: 'DONE' },
        project: { workspaceId },
        assignees: {
          some: { userId },
        },
      },
      include: {
        project: true,
      },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
    });

    // 3. Charger les jalons du projet proches (échéance sous 7 jours)
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    const projectsInWorkspace = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true },
    });

    const projectIds = projectsInWorkspace.map((p) => p.id);

    const upcomingMilestones = await this.prisma.milestone.findMany({
      where: {
        projectId: { in: projectIds },
        completedAt: null,
        dueDate: {
          lte: nextWeek,
        },
      },
      include: {
        project: true,
      },
      orderBy: { dueDate: 'asc' },
    });

    // 4. Calculer les alertes du workspace
    const alerts = await this.calculatePredictiveAlerts(workspaceId);
    const criticalAlertsCount = alerts.filter((a) => a.severity === 'CRITICAL').length;
    const highAlertsCount = alerts.filter((a) => a.severity === 'HIGH').length;

    // 5. Générer le briefing (Bypass si mock ou pas de clé API)
    if (isMock || !this.geminiService.isAvailable()) {
      this.logger.log('Utilisation du briefing matinal mocké.');
      const listTasksStr =
        assignedTasks.length > 0
          ? assignedTasks
              .slice(0, 3)
              .map(
                (t) =>
                  `   - **${t.title}** (${t.project?.name || 'Inbox'}) - Priorité : ${t.priority}`,
              )
              .join('\n')
          : '   - Aucun tâche prioritaire assignée.';

      return `Bonjour ${userName} ! Voici votre briefing matinal de productivité.

📅 **Aperçu de votre journée :**
Vous avez actuellement **${assignedTasks.length} tâches actives** à réaliser dans votre espace de travail. Vos 3 tâches les plus urgentes pour aujourd'hui sont :
${listTasksStr}

⚠️ **Alertes prédictives & Risques détectés :**
Nous avons détecté **${criticalAlertsCount} alerte(s) critique(s)** et **${highAlertsCount} risque(s) élevé(s)** sur le workspace. Notamment, la configuration de sécurité bloque 2 jalons et Alice est en surrégime cette semaine.

💡 **Recommandations du Copilote :**
- Pensez à déléguer ou à replanifier la tâche d'audit de sécurité pour éviter de retarder la mise en production prévue cette semaine.
- Prenez un temps de synchronisation avec Alice pour soulager sa charge.

Passez une excellente journée productive ! ✨`;
    }

    // Mode IA Réel via Gemini
    try {
      this.logger.log('Appel à Gemini 1.5 Flash pour générer le briefing matinal...');
      const model = this.geminiService.getGenerativeModel();

      const tasksText = assignedTasks
        .map(
          (t) =>
            `- Tâche: "${t.title}" | Projet: "${t.project?.name}" | Priorité: ${t.priority} | Échéance: ${t.dueDate ? t.dueDate.toISOString().split('T')[0] : 'Non spécifiée'}`,
        )
        .join('\n');
      const milestonesText = upcomingMilestones
        .map(
          (m) =>
            `- Jalon: "${m.name}" | Projet: "${m.project?.name}" | Échéance: ${m.dueDate ? m.dueDate.toISOString().split('T')[0] : 'Non spécifiée'}`,
        )
        .join('\n');
      const alertsText = alerts
        .slice(0, 5)
        .map((a) => `- Alerte [${a.type} | ${a.severity}]: ${a.message}`)
        .join('\n');

      const prompt = `
Tu es l'assistant de productivité IA "Copilote Proactif" intégré à l'application Planner Pro.
Rédige un briefing matinal personnalisé, chaleureux, concis (maximum 250 mots), structuré et très motivant en français pour l'utilisateur nommé "${userName}".

Voici les données actuelles de sa journée et du workspace :
- Nombre de ses tâches assignées actives : ${assignedTasks.length}
- Ses tâches prioritaires :
${tasksText || 'Aucune tâche spécifique assignée.'}
- Jalons clés à venir dans les 7 jours pour l'équipe :
${milestonesText || "Aucun jalon d'importance cette semaine."}
- Alertes de risques et surcharges du workspace :
${alertsText || 'Aucune alerte à signaler, tout est au vert !'}

Consignes d'écriture :
1. Salue l'utilisateur par son prénom de façon sympathique.
2. Structure la réponse avec des sous-titres ou émojis (ex: 📅 Vos priorités, ⚠️ Risques à surveiller, 💡 Conseils).
3. Donne-lui 1 ou 2 conseils concrets d'action pour sa journée en se basant sur les alertes ou retards.
4. Reste professionnel, motivant et direct. Ne fais pas d'introduction superflue.
`;

      const response = await model.generateContent(prompt);
      return response.response.text().trim();
    } catch (error: unknown) {
      this.logger.error(
        `Erreur lors de la génération du briefing matinal via Gemini: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Fallback sur le texte de démo en cas d'erreur de clé d'API
      return `Bonjour ${userName} ! Vos tâches prioritaires du jour incluent ${assignedTasks.length > 0 ? `"${assignedTasks[0].title}"` : 'des revues de projets'}. Pensez à consulter votre tableau Kanban. Bon travail !`;
    }
  }
}
