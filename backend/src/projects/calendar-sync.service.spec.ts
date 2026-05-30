import { Test, TestingModule } from '@nestjs/testing';
import { CalendarSyncService } from './calendar-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('CalendarSyncService', () => {
  let service: CalendarSyncService;
  let prisma: PrismaService;

  const mockPrisma = {
    integration: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    timeBlock: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarSyncService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CalendarSyncService>(CalendarSyncService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('exportToCalendar', () => {
    it('devrait rejeter si l\'intégration est introuvable', async () => {
      mockPrisma.integration.findUnique.mockResolvedValue(null);

      await expect(
        service.exportToCalendar('workspace-123', 'int-not-found'),
      ).rejects.toThrow(NotFoundException);
    });

    it('devrait rejeter si le type d\'intégration n\'est pas un calendrier', async () => {
      mockPrisma.integration.findUnique.mockResolvedValue({
        id: 'int-123',
        type: 'SLACK',
      });

      await expect(
        service.exportToCalendar('workspace-123', 'int-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('devrait retourner le nombre de créneaux exportés si valide', async () => {
      const integrationId = 'int-cal';
      mockPrisma.integration.findUnique.mockResolvedValue({
        id: integrationId,
        type: 'GOOGLE_CALENDAR',
      });

      mockPrisma.timeBlock.findMany.mockResolvedValue([
        { id: 'block-1', task: { title: 'Tâche A' } },
        { id: 'block-2', task: { title: 'Tâche B' } },
      ]);

      const result = await service.exportToCalendar('workspace-123', integrationId);

      expect(result).toEqual({ success: true, exportedCount: 2 });
    });
  });

  describe('detectCalendarConflicts', () => {
    it('devrait retourner un tableau vide si aucun calendrier externe n\'est connecté', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([]);

      const result = await service.detectCalendarConflicts('workspace-123');

      expect(prisma.integration.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          active: true,
          type: { in: ['GOOGLE_CALENDAR', 'OUTLOOK'] },
        },
      });
      expect(result).toEqual([]);
    });

    it('devrait détecter un conflit si le créneau local d\'Alice chevauche son rendez-vous dentiste simulé', async () => {
      // 1. Calendrier externe Google connecté
      mockPrisma.integration.findMany.mockResolvedValue([
        { id: 'int-gcal', type: 'GOOGLE_CALENDAR', active: true },
      ]);

      // 2. Un bloc horaire pour Alice le 01 Juin 2026 de 11:00 à 13:00 (l'événement externe dentiste est 10:00 - 12:00)
      const localTimeBlocks = [
        {
          id: 'block-1',
          startTime: new Date('2026-06-01T11:00:00Z'),
          endTime: new Date('2026-06-01T13:00:00Z'),
          task: {
            title: 'Tâche urgente de dev',
            assignees: [
              {
                user: {
                  id: 'user-alice',
                  name: 'Alice',
                  email: 'alice@test.com',
                },
              },
            ],
          },
        },
      ];

      mockPrisma.timeBlock.findMany.mockResolvedValue(localTimeBlocks);

      const conflicts = await service.detectCalendarConflicts('workspace-123');

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].localTaskTitle).toBe('Tâche urgente de dev');
      expect(conflicts[0].externalEventTitle).toBe('Rendez-vous dentiste (Google Calendar)');
      expect(conflicts[0].message).toContain('Conflit d\'agenda pour Alice');
    });

    it('devrait ne détecter aucun conflit si les créneaux locaux ne chevauchent pas les événements externes', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        { id: 'int-gcal', type: 'GOOGLE_CALENDAR', active: true },
      ]);

      // Un bloc horaire pour Alice le 01 Juin 2026 de 08:00 à 09:30 (aucun chevauchement avec 10:00 - 12:00)
      const localTimeBlocks = [
        {
          id: 'block-1',
          startTime: new Date('2026-06-01T08:00:00Z'),
          endTime: new Date('2026-06-01T09:30:00Z'),
          task: {
            title: 'Daily Meeting',
            assignees: [
              {
                user: {
                  id: 'user-alice',
                  name: 'Alice',
                  email: 'alice@test.com',
                },
              },
            ],
          },
        },
      ];

      mockPrisma.timeBlock.findMany.mockResolvedValue(localTimeBlocks);

      const conflicts = await service.detectCalendarConflicts('workspace-123');

      expect(conflicts.length).toBe(0);
    });
  });
});
