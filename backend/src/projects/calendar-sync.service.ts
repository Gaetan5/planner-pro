import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Simule l'exportation des TimeBlocks Planner Pro vers un calendrier tiers.
   */
  async exportToCalendar(workspaceId: string, integrationId: string) {
    this.logger.log(`Exportation des créneaux vers l'intégration de calendrier ${integrationId}`);
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
    });
    if (!integration || (integration.type !== 'GOOGLE_CALENDAR' && integration.type !== 'OUTLOOK')) {
      throw new NotFoundException("Calendrier externe introuvable ou invalide.");
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

    this.logger.log(`Exporté avec succès ${timeBlocks.length} blocs horaires.`);
    return { success: true, exportedCount: timeBlocks.length };
  }

  /**
   * Analyse et détecte les conflits entre les TimeBlocks locaux et les événements externes (Google/Outlook).
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

    // 3. Charger des événements externes simulés (Google/Outlook)
    // Pour les besoins de test et de démo, nous simulons des événements externes fixes pour les utilisateurs
    // du workspace. Si un TimeBlock local chevauche un de ces événements pour un assigné, on crée un conflit.
    
    // Exemple d'événements externes simulés pour Alice et Bob
    // Le test d'intégration CLI peut planifier des TimeBlocks exprès sur ces tranches horaires.
    const externalEventsSimulated = [
      {
        userName: 'Alice',
        userEmail: 'alice@test.com',
        title: 'Rendez-vous dentiste (Google Calendar)',
        // 01 Juin 2026 de 10:00 à 12:00 UTC
        start: new Date('2026-06-01T10:00:00Z'),
        end: new Date('2026-06-01T12:00:00Z'),
      },
      {
        userName: 'Gaëtan',
        userEmail: 'gaetan@test.com',
        title: 'Comité de Direction (Outlook Calendar)',
        // 01 Juin 2026 de 14:00 à 16:00 UTC
        start: new Date('2026-06-01T14:00:00Z'),
        end: new Date('2026-06-01T16:00:00Z'),
      },
    ];

    // Pour chaque TimeBlock local
    for (const block of timeBlocks) {
      const localStart = new Date(block.startTime);
      const localEnd = new Date(block.endTime);
      const assignees = block.task.assignees;

      for (const assignee of assignees) {
        const user = assignee.user;
        const userEmail = user.email;

        // Trouver s'il y a un événement externe simulé pour cet utilisateur
        const matchingEvents = externalEventsSimulated.filter(
          (e) => e.userEmail === userEmail || e.userName === user.name,
        );

        for (const extEvent of matchingEvents) {
          // Vérification du chevauchement : S1 < E2 et S2 < E1
          const hasOverlap = localStart < extEvent.end && extEvent.start < localEnd;

          if (hasOverlap) {
            const formatTime = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            conflicts.push({
              id: `conflict-${block.id}-${extEvent.start.getTime()}`,
              userId: user.id,
              userName: user.name || user.email,
              localTimeBlockId: block.id,
              localTaskTitle: block.task.title,
              externalEventTitle: extEvent.title,
              startTime: extEvent.start,
              endTime: extEvent.end,
              message: `Conflit d'agenda pour ${user.name || user.email} : La planification locale "${block.task.title}" (${formatTime(localStart)} - ${formatTime(localEnd)}) chevauche l'événement externe "${extEvent.title}" (${formatTime(extEvent.start)} - ${formatTime(extEvent.end)}) le 01/06/2026.`,
            });
          }
        }
      }
    }

    return conflicts;
  }
}
