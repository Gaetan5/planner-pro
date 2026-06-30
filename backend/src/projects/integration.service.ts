import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface IntegrationDto {
  type: 'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK';
  name: string;
  url?: string;
  calendarId?: string;
}

@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée une intégration pour un workspace.
   */
  async createIntegration(workspaceId: string, dto: IntegrationDto) {
    this.logger.log(`Création d'une intégration ${dto.type} pour le workspace ${workspaceId}`);
    return this.prisma.integration.create({
      data: {
        workspaceId,
        type: dto.type,
        name: dto.name,
        url: dto.url || null,
        calendarId: dto.calendarId || null,
        active: true,
      },
    });
  }

  /**
   * Liste les intégrations d'un workspace.
   */
  async listIntegrations(workspaceId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });

    // Masquer les tokens/urls sensibles pour des raisons de sécurité
    return integrations.map((integration) => {
      if (integration.url) {
        integration.url = this.maskSensitiveUrl(integration.url);
      }
      return integration;
    });
  }

  /**
   * Active ou désactive une intégration.
   */
  async toggleIntegration(integrationId: string) {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
    });
    if (!integration) {
      throw new NotFoundException('Intégration introuvable.');
    }
    return this.prisma.integration.update({
      where: { id: integrationId },
      data: { active: !integration.active },
    });
  }

  /**
   * Supprime une intégration.
   */
  async deleteIntegration(integrationId: string) {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
    });
    if (!integration) {
      throw new NotFoundException('Intégration introuvable.');
    }
    await this.prisma.integration.delete({
      where: { id: integrationId },
    });
    return { success: true };
  }

  /**
   * Envoie une notification asynchrone aux webhooks Slack/Teams configurés et actifs.
   */
  async sendNotification(workspaceId: string, eventName: string, text: string) {
    this.logger.log(
      `Envoi de notification de l'événement "${eventName}" pour le workspace ${workspaceId}`,
    );

    // Charger les intégrations actives
    const integrations = await this.prisma.integration.findMany({
      where: {
        workspaceId,
        active: true,
        type: { in: ['SLACK', 'TEAMS'] },
        url: { not: null },
      },
    });

    if (integrations.length === 0) return;

    for (const integration of integrations) {
      if (!integration.url) continue;

      this.logger.log(`Notification vers le webhook ${integration.type} (${integration.name})...`);

      // Effectuer l'appel asynchrone
      // On lance sans "await" global pour que cela ne bloque pas l'exécution principale (fire and forget)
      // mais on capture les erreurs localement.
      this.postToWebhook(integration.url, integration.type, eventName, text).catch((err) => {
        this.logger.error(
          `Échec d'envoi du webhook ${integration.type} (${integration.name}) : ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  /**
   * Méthode helper pour poster vers le webhook
   */
  private async postToWebhook(url: string, type: string, eventName: string, text: string) {
    let payload = {};

    if (type === 'SLACK') {
      payload = {
        text: `*Planner Pro [${eventName}]*\n${text}`,
      };
    } else if (type === 'TEAMS') {
      payload = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: '8B5CF6',
        summary: eventName,
        sections: [
          {
            activityTitle: eventName,
            activitySubtitle: 'Planner Pro Copilote',
            text: text,
          },
        ],
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const respText = await response.text();
      throw new Error(`HTTP ${response.status} : ${respText}`);
    }
  }

  /**
   * Masque l'URL ou le jeton pour ne pas l'exposer entièrement dans le frontend.
   */
  private maskSensitiveUrl(url: string): string {
    try {
      if (url.length <= 15) return '***';
      return `${url.slice(0, 20)}...****`;
    } catch {
      return '***';
    }
  }
}
