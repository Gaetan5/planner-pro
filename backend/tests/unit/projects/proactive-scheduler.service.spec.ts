import { Test, TestingModule } from '@nestjs/testing';
import { ProactiveSchedulerService } from '../../../src/projects/proactive-scheduler.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { CopilotService } from '../../../src/projects/copilot.service';
import { NotificationsService } from '../../../src/notifications/notifications.service';
import { CalendarSyncService } from '../../../src/projects/calendar-sync.service';
import { TrackingGateway } from '../../../src/tracking/tracking.gateway';

describe('ProactiveSchedulerService', () => {
  let service: ProactiveSchedulerService;

  const mockPrisma = {
    workspace: {
      findMany: jest.fn(),
    },
    membership: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    aiBriefing: {
      upsert: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
    timeBlock: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockCopilotService = {
    calculatePredictiveAlerts: jest.fn(),
    generateBriefing: jest.fn(),
  };

  const mockNotificationsService = {
    createNotification: jest.fn(),
  };

  const mockCalendarSyncService = {
    detectCalendarConflicts: jest.fn(),
  };

  const mockTrackingGateway = {
    server: {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProactiveSchedulerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CopilotService, useValue: mockCopilotService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: CalendarSyncService, useValue: mockCalendarSyncService },
        { provide: TrackingGateway, useValue: mockTrackingGateway },
      ],
    }).compile();

    service = module.get<ProactiveSchedulerService>(ProactiveSchedulerService);

    jest.clearAllMocks();
  });

  describe('runProactiveChecks', () => {
    it('devrait detecter les surcharges et envoyer les notifications', async () => {
      mockPrisma.workspace.findMany.mockResolvedValue([{ id: 'ws-123' }]);
      mockPrisma.membership.findMany.mockResolvedValue([
        {
          userId: 'admin-id',
          role: 'OWNER',
          user: { id: 'admin-id', name: 'Admin', email: 'admin@test.com' },
        },
        {
          userId: 'user-id',
          role: 'CONTRIBUTOR',
          user: { id: 'user-id', name: 'User', email: 'user@test.com' },
        },
      ]);

      mockCopilotService.calculatePredictiveAlerts.mockResolvedValue([
        {
          id: 'alert-overload-user-id',
          type: 'OVERLOADED',
          severity: 'MEDIUM',
          message: 'User est en surcharge de travail.',
          userId: 'user-id',
          userName: 'User',
        },
        {
          id: 'alert-overdue-task-id',
          type: 'OVERDUE',
          severity: 'CRITICAL',
          message: 'Jalon critique en retard.',
          taskId: 'task-123',
        },
      ]);

      await service.runProactiveChecks();

      // Vérifier que la notification de surcharge a été envoyée à l'utilisateur concerné
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-id',
          type: 'SYSTEM',
          title: 'Alerte Surcharge',
          content: 'User est en surcharge de travail.',
        }),
      );

      // Vérifier que la notification de surcharge a été envoyée aux administrateurs (ex: admin-id)
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-id',
          type: 'SYSTEM',
          title: 'Surcharge membre: User',
          content: 'User est en surcharge de travail.',
        }),
      );

      // Vérifier que l'alerte critique OVERDUE a été envoyée à l'administrateur
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-id',
          type: 'SYSTEM',
          title: 'Alerte Critique Workspace: OVERDUE',
          content: 'Jalon critique en retard.',
          taskId: 'task-123',
        }),
      );
    });
  });

  describe('updateAllUserBriefings', () => {
    it('devrait pré-calculer et mettre à jour le briefing IA dans AiBriefing', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'user-1', name: 'Alice', email: 'alice@test.com' },
      ]);

      mockPrisma.membership.findFirst.mockResolvedValue({
        userId: 'user-1',
        workspaceId: 'ws-123',
      });

      mockCopilotService.generateBriefing.mockResolvedValue('Bonjour Alice, voici votre briefing.');

      await service.updateAllUserBriefings();

      expect(mockCopilotService.generateBriefing).toHaveBeenCalledWith('user-1', 'ws-123', true);
      expect(mockPrisma.aiBriefing.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: {
          userId: 'user-1',
          content: 'Bonjour Alice, voici votre briefing.',
        },
        update: {
          content: 'Bonjour Alice, voici votre briefing.',
        },
      });
    });
  });

  describe('runProactiveChecksForWorkspace', () => {
    it('devrait notifier les membres lors de risques sur un workspace ciblé', async () => {
      mockPrisma.membership.findMany.mockResolvedValue([
        {
          userId: 'admin-id',
          role: 'OWNER',
          user: { id: 'admin-id', name: 'Admin', email: 'admin@test.com' },
        },
      ]);

      mockCopilotService.calculatePredictiveAlerts.mockResolvedValue([
        {
          id: 'alert-overload',
          type: 'OVERLOADED',
          severity: 'HIGH',
          message: 'User surcharge',
          userId: 'user-id',
          userName: 'User',
        },
      ]);

      await service.runProactiveChecksForWorkspace('ws-123');

      expect(mockNotificationsService.createNotification).toHaveBeenCalled();
    });
  });

  describe('autoScheduleWorkspace', () => {
    it('devrait planifier des créneaux libres pour les tâches non planifiées', async () => {
      mockPrisma.task.findMany.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Tâche A',
          projectId: 'p1',
          assignees: [{ user: { email: 'alice@test.com' } }],
        },
      ]);

      mockPrisma.timeBlock.count.mockResolvedValue(0);
      mockCalendarSyncService.detectCalendarConflicts.mockResolvedValue([]);
      mockPrisma.timeBlock.findMany.mockResolvedValue([]);

      const result = await service.autoScheduleWorkspace('ws-123');

      expect(result.success).toBe(true);
      expect(result.scheduledCount).toBeGreaterThanOrEqual(0);
    });
  });
});
