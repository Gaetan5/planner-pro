import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CopilotService } from './copilot.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CalendarSyncService } from './calendar-sync.service';
import { TrackingGateway } from '../tracking/tracking.gateway';

@Injectable()
export class ProactiveSchedulerService {
  private readonly logger = new Logger(ProactiveSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly copilotService: CopilotService,
    private readonly notificationsService: NotificationsService,
    private readonly calendarSyncService: CalendarSyncService,
    @Inject(forwardRef(() => TrackingGateway))
    private readonly trackingGateway: TrackingGateway,
  ) {}

  /**
   * Cron qui se déclenche toutes les heures pour vérifier les risques de surcharge et jalons.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runProactiveChecks() {
    this.logger.log("Début de l'analyse proactive planifiée (surcharges, retards, etc.)...");

    // 1. Récupérer tous les workspaces actifs
    const workspaces = await this.prisma.workspace.findMany({
      where: { deletedAt: null },
    });

    for (const ws of workspaces) {
      try {
        // Calculer les alertes prédictives du workspace
        const alerts = await this.copilotService.calculatePredictiveAlerts(ws.id);

        // Récupérer les membres (pour savoir qui notifier, ex: OWNER ou ADMIN, ou l'utilisateur concerné)
        const members = await this.prisma.membership.findMany({
          where: { workspaceId: ws.id },
          include: { user: true },
        });

        const administrators = members.filter((m) => m.role === 'OWNER' || m.role === 'ADMIN');

        for (const alert of alerts) {
          // Si surcharge d'un utilisateur, on notifie l'utilisateur concerné et les admins
          if (alert.type === 'OVERLOADED' && alert.userId) {
            // Notifier l'utilisateur
            await this.notificationsService.createNotification({
              userId: alert.userId,
              senderId: undefined,
              type: 'SYSTEM',
              title: 'Alerte Surcharge',
              content: alert.message,
            });

            // Notifier les administrateurs
            for (const admin of administrators) {
              if (admin.userId !== alert.userId) {
                await this.notificationsService.createNotification({
                  userId: admin.userId,
                  senderId: undefined,
                  type: 'SYSTEM',
                  title: `Surcharge membre: ${alert.userName}`,
                  content: alert.message,
                });
              }
            }
          }

          // Si jalon ou tâche critique en retard, on notifie tous les admins du workspace
          if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
            for (const admin of administrators) {
              await this.notificationsService.createNotification({
                userId: admin.userId,
                senderId: undefined,
                type: 'SYSTEM',
                title: `Alerte Critique Workspace: ${alert.type}`,
                content: alert.message,
                taskId: alert.taskId,
              });
            }
          }
        }
      } catch (err: unknown) {
        this.logger.error(
          `Erreur lors du traitement proactif pour le workspace ${ws.id}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    this.logger.log('Analyse proactive planifiée terminée.');
  }

  /**
   * Cron quotidien pour pré-calculer et mettre à jour les briefings matidinaux de tous les utilisateurs.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async updateAllUserBriefings() {
    this.logger.log('Début du pré-calcul planifié des briefings matinaux...');

    const users = await this.prisma.user.findMany();

    for (const u of users) {
      try {
        // Trouver le premier workspace auquel appartient l'utilisateur
        const membership = await this.prisma.membership.findFirst({
          where: { userId: u.id },
        });

        if (!membership) continue;

        // Générer le briefing (mocké par défaut ou via Gemini)
        const briefingText = await this.copilotService.generateBriefing(
          u.id,
          membership.workspaceId,
          true,
        );

        // Mettre à jour dans la table AiBriefing
        await this.prisma.aiBriefing.upsert({
          where: { userId: u.id },
          create: {
            userId: u.id,
            content: briefingText,
          },
          update: {
            content: briefingText,
          },
        });
      } catch (err: unknown) {
        this.logger.error(
          `Erreur lors de la génération de briefing pour l'utilisateur ${u.id}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    this.logger.log('Pré-calcul planifié des briefings matinaux terminé.');
  }

  /**
   * Effectue l'analyse proactive événementielle pour un workspace ciblé (détection immédiate).
   */
  async runProactiveChecksForWorkspace(workspaceId: string) {
    this.logger.log(`Analyse proactive événementielle lancée pour le workspace ${workspaceId}`);
    try {
      const alerts = await this.copilotService.calculatePredictiveAlerts(workspaceId);
      const members = await this.prisma.membership.findMany({
        where: { workspaceId },
        include: { user: true },
      });
      const administrators = members.filter((m) => m.role === 'OWNER' || m.role === 'ADMIN');

      for (const alert of alerts) {
        if (alert.type === 'OVERLOADED' && alert.userId) {
          await this.notificationsService.createNotification({
            userId: alert.userId,
            senderId: undefined,
            type: 'SYSTEM',
            title: 'Alerte Surcharge',
            content: alert.message,
          });

          for (const admin of administrators) {
            if (admin.userId !== alert.userId) {
              await this.notificationsService.createNotification({
                userId: admin.userId,
                senderId: undefined,
                type: 'SYSTEM',
                title: `Surcharge membre: ${alert.userName}`,
                content: alert.message,
              });
            }
          }
        }

        if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
          for (const admin of administrators) {
            await this.notificationsService.createNotification({
              userId: admin.userId,
              senderId: undefined,
              type: 'SYSTEM',
              title: `Alerte Critique Workspace: ${alert.type}`,
              content: alert.message,
              taskId: alert.taskId,
            });
          }
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Erreur lors du traitement proactif événementiel pour le workspace ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Planification automatique de créneaux TimeBlocks libres de conflits pour toutes les tâches du workspace.
   */
  async autoScheduleWorkspace(workspaceId: string) {
    this.logger.log(`[Auto-Schedule] Planification automatique pour le workspace ${workspaceId}`);

    // 1. Récupérer toutes les tâches actives, non terminées du workspace
    const tasks = await this.prisma.task.findMany({
      where: {
        project: { workspaceId, deletedAt: null },
        status: { in: ['TODO', 'IN_PROGRESS'] },
        deletedAt: null,
      },
      include: {
        assignees: { include: { user: true } },
        project: true,
      },
    });

    const unscheduledTasks: typeof tasks = [];
    for (const t of tasks) {
      const tbCount = await this.prisma.timeBlock.count({ where: { taskId: t.id } });
      if (tbCount === 0) {
        unscheduledTasks.push(t);
      }
    }

    if (unscheduledTasks.length === 0) {
      this.logger.log(`[Auto-Schedule] Aucune tâche non planifiée à scheduler.`);
      return { success: true, scheduledCount: 0 };
    }

    // 2. Charger les conflits d'agendas externes détectés
    const existingConflicts = await this.calendarSyncService.detectCalendarConflicts(workspaceId);

    // Charger aussi tous les TimeBlocks déjà alloués du workspace
    const existingTimeBlocks = await this.prisma.timeBlock.findMany({
      where: {
        task: {
          project: { workspaceId },
          deletedAt: null,
        },
      },
    });

    let scheduledCount = 0;
    const now = new Date();
    // Commencer la planification à partir de demain à 9h00 UTC
    const startPlanner = new Date(now);
    startPlanner.setDate(now.getDate() + 1);
    startPlanner.setUTCHours(9, 0, 0, 0);

    const allocatedBlocks: Array<{ start: Date; end: Date; taskId: string }> = [];

    for (const task of unscheduledTasks) {
      const durationHours = 2; // Allouer des plages de 2 heures par défaut
      const assignees = task.assignees.map((a) => a.user.email);

      let foundPlage = false;
      const checkStart = new Date(startPlanner);

      // Chercher sur les 30 prochains jours maximum
      for (let day = 0; day < 30 && !foundPlage; day++) {
        // Plage de travail standard de 9h à 18h
        for (let hour = 9; hour <= 16 && !foundPlage; hour++) {
          const slotStart = new Date(checkStart);
          slotStart.setUTCHours(hour, 0, 0, 0);

          const slotEnd = new Date(slotStart);
          slotEnd.setUTCHours(hour + durationHours, 0, 0, 0);

          // Éviter les week-ends
          const dayOfWeek = slotStart.getUTCDay();
          if (dayOfWeek === 0 || dayOfWeek === 6) {
            continue;
          }

          // Vérifier les chevauchements
          const overlapDB = existingTimeBlocks.some(
            (tb) => new Date(tb.startTime) < slotEnd && slotStart < new Date(tb.endTime),
          );

          const overlapAllocated = allocatedBlocks.some(
            (ab) => ab.start < slotEnd && slotStart < ab.end,
          );

          const overlapConflicts = existingConflicts.some((c) => {
            const hasUserMatch =
              assignees.length === 0 ||
              assignees.includes(c.userName) ||
              assignees.includes(c.userId);
            return (
              hasUserMatch && new Date(c.startTime) < slotEnd && slotStart < new Date(c.endTime)
            );
          });

          if (!overlapDB && !overlapAllocated && !overlapConflicts) {
            await this.prisma.timeBlock.create({
              data: {
                taskId: task.id,
                startTime: slotStart,
                endTime: slotEnd,
              },
            });

            allocatedBlocks.push({
              start: slotStart,
              end: slotEnd,
              taskId: task.id,
            });

            scheduledCount++;
            foundPlage = true;
          }
        }
        checkStart.setDate(checkStart.getDate() + 1);
      }
    }

    if (scheduledCount > 0 && this.trackingGateway?.server) {
      this.trackingGateway.server
        .to(`workspace:${workspaceId}`)
        .emit('project-data-updated', { workspaceId });
    }

    return { success: true, scheduledCount };
  }
}
