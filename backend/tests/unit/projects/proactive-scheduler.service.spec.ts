import { Test, TestingModule } from '@nestjs/testing';
import { ProactiveSchedulerService } from '../../../src/projects/proactive-scheduler.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { CopilotService } from '../../../src/projects/copilot.service';
import { NotificationsService } from '../../../src/notifications/notifications.service';

describe('ProactiveSchedulerService', () => {
  let service: ProactiveSchedulerService;
  let prisma: PrismaService;
  let copilotService: CopilotService;
  let notificationsService: NotificationsService;

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
    },
    aiBriefing: {
      upsert: jest.fn(),
    },
  };

  const mockCopilotService = {
    calculatePredictiveAlerts: jest.fn(),
    generateBriefing: jest.fn(),
  };

  const mockNotificationsService = {
    createNotification: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProactiveSchedulerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CopilotService, useValue: mockCopilotService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<ProactiveSchedulerService>(ProactiveSchedulerService);
    prisma = module.get<PrismaService>(PrismaService);
    copilotService = module.get<CopilotService>(CopilotService);
    notificationsService = module.get<NotificationsService>(NotificationsService);

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
});
