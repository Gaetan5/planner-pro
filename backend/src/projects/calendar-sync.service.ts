import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../auth/encryption.util';

export interface CalendarConflict {
  id: string;
  userId: string;
  userName: string;
  localTimeBlockId: string;
  localTaskTitle: string;
  externalEventTitle: string;
  startTime: Date;
  endTime: Date;
  message: string;
}

type OAuthCalendarProvider = 'GOOGLE_CALENDAR' | 'OUTLOOK';

export interface CalendarSyncSkip {
  integrationId: string;
  reason: 'NOT_CONFIGURED';
}

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  userEmail: string;
  userName: string;
}

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getOAuthCredentials(provider: string): { clientId?: string; clientSecret?: string } {
    return provider === 'GOOGLE_CALENDAR'
      ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
      : {
          clientId: process.env.MICROSOFT_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        };
  }

  private hasOAuthCredentials(provider: string): boolean {
    const { clientId, clientSecret } = this.getOAuthCredentials(provider);
    return Boolean(clientId && clientSecret);
  }

  /**
   * Identifiants OAuth obligatoires quel que soit NODE_ENV : aucun jeton simulé n'est produit (S5).
   */
  private requireOAuthCredentials(provider: string): { clientId: string; clientSecret: string } {
    const { clientId, clientSecret } = this.getOAuthCredentials(provider);
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        `La connexion OAuth au fournisseur ${provider} n'est pas configurée sur ce serveur.`,
      );
    }
    return { clientId, clientSecret };
  }

  /**
   * Exporte les TimeBlocks Planner Pro vers un calendrier tiers connecté par OAuth.
   */
  async exportToCalendar(workspaceId: string, integrationId: string) {
    this.logger.log(`Exportation des créneaux vers l'intégration de calendrier ${integrationId}`);
    // Intégration toujours chargée dans le workspace de l'appelant (S14) : sinon 404
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, workspaceId },
    });
    if (
      !integration ||
      (integration.type !== 'GOOGLE_CALENDAR' && integration.type !== 'OUTLOOK')
    ) {
      throw new NotFoundException('Calendrier externe introuvable ou invalide.');
    }

    // Aucun export simulé : sans jeton OAuth réel ni identifiants serveur, refus explicite (S5)
    if (!integration.accessToken || !this.hasOAuthCredentials(integration.type)) {
      throw new BadRequestException(
        "Ce calendrier n'est pas connecté par OAuth : aucun export n'est possible.",
      );
    }

    const timeBlocks = await this.prisma.timeBlock.findMany({
      where: {
        task: {
          project: { workspaceId },
          deletedAt: null,
        },
      },
      include: {
        task: true,
      },
    });

    const token =
      integration.expiresAt && new Date(integration.expiresAt) < new Date()
        ? await this.refreshAccessToken(workspaceId, integration.id)
        : decrypt(integration.accessToken);

    let exportedRealCount = 0;

    for (const block of timeBlocks) {
      try {
        const provider = integration.type;
        const calendarId = integration.calendarId || 'primary';
        const url =
          provider === 'GOOGLE_CALENDAR'
            ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
                calendarId,
              )}/events`
            : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
                calendarId === 'calendar' ? 'primary' : calendarId,
              )}/events`;

        const body =
          provider === 'GOOGLE_CALENDAR'
            ? {
                summary: block.task.title,
                description: block.task.description || '',
                start: { dateTime: new Date(block.startTime).toISOString() },
                end: { dateTime: new Date(block.endTime).toISOString() },
              }
            : {
                subject: block.task.title,
                body: {
                  contentType: 'text',
                  content: block.task.description || '',
                },
                start: {
                  dateTime: new Date(block.startTime).toISOString().split('.')[0],
                  timeZone: 'UTC',
                },
                end: {
                  dateTime: new Date(block.endTime).toISOString().split('.')[0],
                  timeZone: 'UTC',
                },
              };

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          exportedRealCount++;
        } else {
          const errText = await res.text();
          this.logger.warn(
            `Impossible d'exporter le TimeBlock ${block.id} vers ${provider}: ${res.statusText}. Détails : ${errText}`,
          );
        }
      } catch (err: unknown) {
        this.logger.error(
          `Erreur d'exportation REST : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(`Exporté ${exportedRealCount} blocs horaires sur ${timeBlocks.length}.`);
    return { success: true, exportedCount: exportedRealCount, exportedRealCount };
  }

  /**
   * Analyse et détecte les conflits entre les TimeBlocks locaux et les événements externes (Google/Outlook).
   * Supporte les flux iCal/ICS et JSON configurés sur les intégrations et l'API OAuth des fournisseurs.
   * Une intégration sans source réelle est ignorée (aucun événement simulé, S5).
   */
  async detectCalendarConflicts(workspaceId: string): Promise<CalendarConflict[]> {
    this.logger.log(`Détection de conflits de calendrier pour le workspace ${workspaceId}`);
    const conflicts: CalendarConflict[] = [];

    // 1. Récupérer les intégrations de calendrier actives du workspace
    const calendarIntegrations = await this.prisma.integration.findMany({
      where: {
        workspaceId,
        active: true,
        type: { in: ['GOOGLE_CALENDAR', 'OUTLOOK'] },
      },
    });

    if (calendarIntegrations.length === 0) {
      // Aucun calendrier connecté = aucun conflit externe détecté
      return [];
    }

    // 2. Récupérer tous les TimeBlocks locaux actifs dans le workspace
    const timeBlocks = await this.prisma.timeBlock.findMany({
      where: {
        task: {
          project: { workspaceId },
          deletedAt: null,
        },
      },
      include: {
        task: {
          include: {
            assignees: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (timeBlocks.length === 0) {
      return [];
    }

    // 3. Charger les événements externes réels de chaque intégration active
    const externalEvents: Array<{
      userName: string;
      userEmail: string;
      title: string;
      start: Date;
      end: Date;
    }> = [];

    for (const integration of calendarIntegrations) {
      // L'intégration est attribuée à un utilisateur seulement si calendarId est une adresse e-mail
      const targetEmail = integration.calendarId?.includes('@') ? integration.calendarId : '';
      const targetName = targetEmail ? targetEmail.split('@')[0] : '';

      if (integration.url && integration.url.trim().startsWith('http')) {
        // Flux externe configurable (iCal/ICS ou JSON)
        const fetchedEvents = await this.fetchExternalEvents(
          integration.url,
          targetEmail,
          targetName,
        );
        externalEvents.push(...fetchedEvents);
      } else if (integration.accessToken && this.hasOAuthCredentials(integration.type)) {
        let token = decrypt(integration.accessToken);
        if (integration.expiresAt && new Date(integration.expiresAt) < new Date()) {
          token = await this.refreshAccessToken(workspaceId, integration.id);
        }
        const fetchedEvents = await this.fetchOAuthCalendarEvents(
          integration.type as OAuthCalendarProvider,
          token,
          integration.calendarId || 'primary',
        );
        externalEvents.push(
          ...fetchedEvents.map((e) => ({
            ...e,
            userEmail: targetEmail,
            userName: targetName,
          })),
        );
      }
      // Sinon : aucune source réelle configurée, l'intégration est ignorée (S5)
    }

    // 4. Détecter les chevauchements entre les TimeBlocks locaux et les événements externes
    for (const block of timeBlocks) {
      const localStart = new Date(block.startTime);
      const localEnd = new Date(block.endTime);
      const assignees = block.task.assignees;

      for (const assignee of assignees) {
        const user = assignee.user;
        const userEmail = user.email;

        // Trouver les événements externes correspondant à cet utilisateur
        const matchingEvents = externalEvents.filter(
          (e) =>
            (Boolean(e.userEmail) && e.userEmail === userEmail) ||
            (Boolean(e.userName) && e.userName === user.name),
        );

        for (const extEvent of matchingEvents) {
          // Vérification du chevauchement : S1 < E2 et S2 < E1
          const hasOverlap = localStart < extEvent.end && extEvent.start < localEnd;

          if (hasOverlap) {
            const formatDate = (d: Date) => d.toLocaleDateString('fr-FR');
            const formatTime = (d: Date) =>
              d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

            conflicts.push({
              id: `conflict-${block.id}-${extEvent.start.getTime()}`,
              userId: user.id,
              userName: user.name || user.email,
              localTimeBlockId: block.id,
              localTaskTitle: block.task.title,
              externalEventTitle: extEvent.title,
              startTime: extEvent.start,
              endTime: extEvent.end,
              message: `Conflit d'agenda pour ${user.name || user.email} : La planification locale "${block.task.title}" (${formatTime(localStart)} - ${formatTime(localEnd)}) chevauche l'événement externe "${extEvent.title}" (${formatTime(extEvent.start)} - ${formatTime(extEvent.end)}) le ${formatDate(extEvent.start)}.`,
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Récupère et analyse les événements depuis un flux d'agenda externe (ICS/iCal ou JSON).
   */
  private async fetchExternalEvents(
    url: string,
    userEmail: string,
    userName: string,
  ): Promise<CalendarEvent[]> {
    try {
      this.logger.log(`Fetching external calendar from URL: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(`External calendar request failed with status ${response.status}.`);
        throw new BadGatewayException(
          'Un agenda externe est indisponible. Vérifiez son URL ou réessayez ultérieurement.',
        );
      }
      const text = await response.text();
      const trimmedText = text.trim();

      // 1. Essayer de parser comme du JSON
      if (trimmedText.startsWith('[') || trimmedText.startsWith('{')) {
        try {
          const data = JSON.parse(trimmedText);
          const events = Array.isArray(data) ? data : [data];
          return events.map((e) => ({
            title: e.title || e.summary || 'Événement Externe',
            start: new Date(e.start || e.startTime),
            end: new Date(e.end || e.endTime),
            userEmail: e.userEmail || userEmail,
            userName: e.userName || userName,
          }));
        } catch {
          this.logger.warn(`Failed to parse response as JSON, trying ICS parser.`);
        }
      }

      // 2. Essayer de parser comme de l'iCal / ICS
      if (text.includes('BEGIN:VCALENDAR') || text.includes('BEGIN:VEVENT')) {
        return this.parseICS(text, userEmail, userName);
      }

      this.logger.warn('External calendar returned an unsupported format.');
      throw new BadGatewayException(
        'Le format de réponse de l’agenda externe n’est pas pris en charge.',
      );
    } catch (err: unknown) {
      if (err instanceof BadGatewayException) {
        throw err;
      }
      this.logger.error(
        `Unable to fetch external calendar: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadGatewayException(
        'Impossible de charger un agenda externe. Réessayez ultérieurement.',
      );
    }
  }

  /**
   * Parser iCal / ICS custom robuste
   */
  private parseICS(icsText: string, userEmail: string, userName: string): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    const vevents = icsText.split('BEGIN:VEVENT');

    for (let i = 1; i < vevents.length; i++) {
      const block = vevents[i].split('END:VEVENT')[0];
      const summaryMatch = block.match(/SUMMARY:(.*)/);
      const dtstartMatch = block.match(/DTSTART:(.*)/);
      const dtendMatch = block.match(/DTEND:(.*)/);

      if (dtstartMatch && dtendMatch) {
        const title = summaryMatch ? summaryMatch[1].trim() : 'Événement Externe';
        const startStr = dtstartMatch[1].trim();
        const endStr = dtendMatch[1].trim();

        const parseIcsDate = (str: string): Date => {
          const cleaned = str.replace(/[^0-9T]/g, '');
          if (cleaned.length >= 15) {
            const y = cleaned.substring(0, 4);
            const m = cleaned.substring(4, 6);
            const d = cleaned.substring(6, 8);
            const hh = cleaned.substring(9, 11);
            const mm = cleaned.substring(11, 13);
            const ss = cleaned.substring(13, 15);
            return new Date(
              Date.UTC(
                parseInt(y),
                parseInt(m) - 1,
                parseInt(d),
                parseInt(hh),
                parseInt(mm),
                parseInt(ss),
              ),
            );
          }
          return new Date(str);
        };

        events.push({
          title,
          start: parseIcsDate(startStr),
          end: parseIcsDate(endStr),
          userEmail,
          userName,
        });
      }
    }
    return events;
  }

  /**
   * Récupère les événements réels via API REST Google/Microsoft en utilisant le token OAuth2.
   */
  private async fetchOAuthCalendarEvents(
    provider: 'GOOGLE_CALENDAR' | 'OUTLOOK',
    accessToken: string,
    calendarId: string,
  ): Promise<CalendarEvent[]> {
    try {
      const url =
        provider === 'GOOGLE_CALENDAR'
          ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
              calendarId,
            )}/events?singleEvents=true&maxResults=100`
          : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
              calendarId === 'calendar' ? 'primary' : calendarId,
            )}/events?$top=100`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        this.logger.warn(
          `Échec de récupération des événements via API OAuth ${provider} : ${response.statusText}. Détails : ${errText}`,
        );
        return [];
      }

      const data = await response.json();
      if (provider === 'GOOGLE_CALENDAR') {
        const items = data.items || [];
        return items.map(
          (item: {
            summary?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
          }) => ({
            title: item.summary || 'Événement Externe Google',
            start: new Date(item.start?.dateTime || item.start?.date || ''),
            end: new Date(item.end?.dateTime || item.end?.date || ''),
          }),
        );
      } else {
        const value = data.value || [];
        return value.map(
          (item: {
            subject?: string;
            start?: { dateTime?: string };
            end?: { dateTime?: string };
          }) => ({
            title: item.subject || 'Événement Externe Outlook',
            start: new Date(item.start?.dateTime ? item.start.dateTime + 'Z' : ''),
            end: new Date(item.end?.dateTime ? item.end.dateTime + 'Z' : ''),
          }),
        );
      }
    } catch (err: unknown) {
      this.logger.error(
        `Erreur lors de l'appel d'API calendrier OAuth : ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private requireClientId(provider: OAuthCalendarProvider): string {
    const { clientId } = this.getOAuthCredentials(provider);
    if (!clientId) {
      throw new ServiceUnavailableException(
        `La connexion OAuth au fournisseur ${provider} n'est pas configurée sur ce serveur.`,
      );
    }
    return clientId;
  }

  /**
   * Génère l'URL d'autorisation OAuth2 pour Google ou Outlook.
   */
  generateAuthUrl(provider: 'GOOGLE_CALENDAR' | 'OUTLOOK', workspaceId: string): string {
    const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/oauth/callback`;
    if (provider === 'GOOGLE_CALENDAR') {
      const clientId = this.requireClientId(provider);
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&response_type=code&scope=${encodeURIComponent(
        'https://www.googleapis.com/auth/calendar',
      )}&access_type=offline&prompt=consent&state=${encodeURIComponent(workspaceId + ':GOOGLE_CALENDAR')}`;
    } else {
      const clientId = this.requireClientId(provider);
      return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&response_type=code&scope=${encodeURIComponent(
        'offline_access Calendars.ReadWrite',
      )}&response_mode=query&state=${encodeURIComponent(workspaceId + ':OUTLOOK')}`;
    }
  }

  /**
   * Gère le callback OAuth2, échange le code contre les tokens, les chiffre et les stocke.
   */
  async handleOAuthCallback(
    workspaceId: string,
    provider: 'GOOGLE_CALENDAR' | 'OUTLOOK',
    code: string,
  ) {
    this.logger.log(
      `Échange du code OAuth pour le workspace ${workspaceId} avec le fournisseur ${provider}`,
    );
    const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/oauth/callback`;
    const { clientId, clientSecret } = this.requireOAuthCredentials(provider);

    const tokenUrl =
      provider === 'GOOGLE_CALENDAR'
        ? 'https://oauth2.googleapis.com/token'
        : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    const tokens = await this.requestTokens(
      tokenUrl,
      new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      `Échec d'authentification auprès du fournisseur de calendrier ${provider}.`,
    );

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expires_in || 3600));

    // Chiffrer de manière sécurisée avant persistance en BDD
    const encryptedAccess = encrypt(tokens.access_token);
    const encryptedRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined;

    // Sauvegarder ou mettre à jour l'intégration du workspace
    const existingIntegration = await this.prisma.integration.findFirst({
      where: { workspaceId, type: provider },
    });

    const integration = await this.prisma.integration.upsert({
      where: {
        id: existingIntegration?.id || 'new-integration-uuid',
      },
      create: {
        workspaceId,
        type: provider,
        name: provider === 'GOOGLE_CALENDAR' ? 'Google Calendar OAuth' : 'Outlook Calendar OAuth',
        active: true,
        calendarId: provider === 'GOOGLE_CALENDAR' ? 'primary' : 'calendar',
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh ?? null,
        expiresAt,
      },
      update: {
        active: true,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
      },
    });

    return {
      success: true,
      integrationId: integration.id,
      provider,
    };
  }

  /**
   * Appel au point de jeton OAuth du fournisseur. Tout échec est remonté (aucun jeton de repli).
   */
  private async requestTokens(
    tokenUrl: string,
    body: URLSearchParams,
    failureMessage: string,
  ): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err: unknown) {
      this.logger.error(
        `Erreur HTTP lors de l'appel OAuth : ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadGatewayException(failureMessage);
    }

    if (!res.ok) {
      this.logger.error(`Échec de l'appel OAuth au fournisseur (HTTP ${res.status}).`);
      throw new BadGatewayException(failureMessage);
    }

    const tokens = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token) {
      throw new BadGatewayException(failureMessage);
    }
    return { ...tokens, access_token: tokens.access_token };
  }

  /**
   * Rafraîchit de manière sécurisée un jeton OAuth expiré.
   */
  async refreshAccessToken(workspaceId: string, integrationId: string): Promise<string> {
    // Jamais de rafraîchissement d'une intégration d'un autre workspace (S14)
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, workspaceId },
    });

    if (!integration || !integration.refreshToken) {
      throw new NotFoundException('Intégration ou Refresh Token introuvable.');
    }

    const provider = integration.type as OAuthCalendarProvider;
    const { clientId, clientSecret } = this.requireOAuthCredentials(provider);
    const decryptedRefresh = decrypt(integration.refreshToken);

    const tokenUrl =
      provider === 'GOOGLE_CALENDAR'
        ? 'https://oauth2.googleapis.com/token'
        : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    const tokens = await this.requestTokens(
      tokenUrl,
      new URLSearchParams({
        refresh_token: decryptedRefresh,
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      `Impossible de rafraîchir le jeton d'accès pour ${provider}.`,
    );
    const newAccessToken = tokens.access_token;
    // Garder l'ancien refresh token si le fournisseur ne le renouvelle pas
    const newRefreshToken = tokens.refresh_token || decryptedRefresh;

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expires_in || 3600));

    await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        accessToken: encrypt(newAccessToken),
        refreshToken: encrypt(newRefreshToken),
        expiresAt,
      },
    });

    return newAccessToken;
  }

  /**
   * Synchronisation bidirectionnelle : importe des événements externes vers l'agenda local (TimeBlocks).
   * Seules les sources réelles (flux URL, API OAuth avec identifiants) sont importées ; les autres
   * intégrations sont signalées `NOT_CONFIGURED` (S5). La tâche technique est créée au nom de l'appelant.
   */
  async syncCalendarEvents(
    workspaceId: string,
    userId: string,
  ): Promise<{ importedCount: number; skipped: CalendarSyncSkip[] }> {
    this.logger.log(
      `Synchronisation bidirectionnelle des événements de calendrier pour le workspace ${workspaceId}`,
    );
    let importedCount = 0;
    const skipped: CalendarSyncSkip[] = [];

    // 1. Trouver les intégrations actives
    const integrations = await this.prisma.integration.findMany({
      where: {
        workspaceId,
        active: true,
        type: { in: ['GOOGLE_CALENDAR', 'OUTLOOK'] },
      },
    });

    for (const integration of integrations) {
      const targetEmail = integration.calendarId?.includes('@') ? integration.calendarId : '';
      const targetName = targetEmail ? targetEmail.split('@')[0] : '';

      // 2. Récupérer les événements externes réels
      let events: CalendarEvent[];
      if (integration.url) {
        // Synchro par URL publique (iCal/ICS ou JSON)
        events = await this.fetchExternalEvents(integration.url, targetEmail, targetName);
      } else if (integration.accessToken && this.hasOAuthCredentials(integration.type)) {
        // OAuth2 : rafraîchir le jeton si expiré
        const token =
          integration.expiresAt && new Date(integration.expiresAt) < new Date()
            ? await this.refreshAccessToken(workspaceId, integration.id)
            : decrypt(integration.accessToken);
        events = await this.fetchOAuthCalendarEvents(
          integration.type as OAuthCalendarProvider,
          token,
          integration.calendarId || 'primary',
        );
      } else {
        skipped.push({ integrationId: integration.id, reason: 'NOT_CONFIGURED' });
        continue;
      }

      // 3. Importer ces événements comme TimeBlocks liés à une tâche de synchronisation
      // On cherche ou crée une tâche de synchronisation dans le premier projet du workspace
      const project = await this.prisma.project.findFirst({
        where: { workspaceId, deletedAt: null },
      });

      if (!project) continue;

      let syncTask = await this.prisma.task.findFirst({
        where: { projectId: project.id, title: 'Synchronisation Calendrier', deletedAt: null },
      });

      if (!syncTask) {
        syncTask = await this.prisma.task.create({
          data: {
            title: 'Synchronisation Calendrier',
            description:
              'Tâche automatique contenant les plages horaires synchronisées de vos agendas externes.',
            status: 'IN_PROGRESS',
            projectId: project.id,
            userId,
          },
        });
      }

      // Importer chaque événement
      for (const event of events) {
        // Éviter les doublons basés sur l'heure de début/fin
        const existingBlock = await this.prisma.timeBlock.findFirst({
          where: {
            taskId: syncTask.id,
            startTime: event.start,
            endTime: event.end,
          },
        });

        if (!existingBlock) {
          await this.prisma.timeBlock.create({
            data: {
              taskId: syncTask.id,
              startTime: event.start,
              endTime: event.end,
            },
          });
          importedCount++;
        }
      }
    }

    return { importedCount, skipped };
  }
}
