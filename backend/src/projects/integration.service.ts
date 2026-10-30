import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface IntegrationDto {
  type: 'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK';
  name: string;
  url?: string;
  calendarId?: string;
}

/**
 * Champs d'une intégration renvoyables par l'API : jamais `accessToken` ni `refreshToken` (S14).
 */
export const INTEGRATION_PUBLIC_SELECT = {
  id: true,
  type: true,
  name: true,
  url: true,
  calendarId: true,
  active: true,
  expiresAt: true,
  workspaceId: true,
  createdAt: true,
  updatedAt: true,
} as const;

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
      select: INTEGRATION_PUBLIC_SELECT,
    });
  }

  /**
   * Liste les intégrations d'un workspace.
   */
  async listIntegrations(workspaceId: string) {
    // Projection explicite : les jetons OAuth, même chiffrés, ne sortent jamais de l'API (S14)
    const integrations = await this.prisma.integration.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: INTEGRATION_PUBLIC_SELECT,
    });

    // Masquer les URL sensibles (webhooks, flux privés)
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
      select: INTEGRATION_PUBLIC_SELECT,
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
   * Retourne l'état réel de chaque intégration d'un workspace (P1) :
   * NOT_CONFIGURED tant qu'aucune source réelle n'existe (URL de flux ou de webhook, ou jeton OAuth
   * avec identifiants serveur), jamais d'état « démo ».
   */
  async getIntegrationsStatus(workspaceId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { workspaceId },
    });

    return integrations.map((integration) => {
      let status: 'CONNECTED' | 'EXPIRED' | 'NOT_CONFIGURED' | 'DISABLED' = 'CONNECTED';

      if (!integration.active) {
        status = 'DISABLED';
      } else if (integration.type === 'GOOGLE_CALENDAR' || integration.type === 'OUTLOOK') {
        const hasCredentials =
          integration.type === 'GOOGLE_CALENDAR'
            ? process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            : process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET;
        const hasOAuthSource = Boolean(integration.accessToken && hasCredentials);

        if (!integration.url && !hasOAuthSource) {
          status = 'NOT_CONFIGURED';
        } else if (
          !integration.url &&
          integration.expiresAt &&
          new Date(integration.expiresAt) < new Date()
        ) {
          status = 'EXPIRED';
        }
      } else if (!integration.url) {
        status = 'NOT_CONFIGURED';
      }

      return {
        id: integration.id,
        type: integration.type,
        name: integration.name,
        active: integration.active,
        status,
        expiresAt: integration.expiresAt,
      };
    });
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
