import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CopilotService } from './copilot.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ProactiveSchedulerService {
  private readonly logger = new Logger(ProactiveSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly copilotService: CopilotService,
    private readonly notificationsService: NotificationsService,
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
      } catch (err: any) {
        this.logger.error(
          `Erreur lors du traitement proactif pour le workspace ${ws.id}: ${err instanceof Error ? err.message : String(err)}`,
          err.stack,
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
      } catch (err: any) {
        this.logger.error(
          `Erreur lors de la génération de briefing pour l'utilisateur ${u.id}: ${err instanceof Error ? err.message : String(err)}`,
          err.stack,
        );
      }
    }

    this.logger.log('Pré-calcul planifié des briefings matinaux terminé.');
  }
}
