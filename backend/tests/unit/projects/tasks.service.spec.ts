import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from '../../../src/projects/tasks.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { NotesService } from '../../../src/notes/notes.service';
import { IntegrationService } from '../../../src/projects/integration.service';
import { NotificationsService } from '../../../src/notifications/notifications.service';
import { ProjectPermissionsService } from '../../../src/projects/project-permissions.service';
import { BadRequestException } from '@nestjs/common';

describe('TasksService - Critical Path Method (CPM)', () => {
  let service: TasksService;

  const mockPrisma = {
    $transaction: jest.fn(async (callback) => callback(mockPrisma)),
    task: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    taskDependency: {
      findMany: jest.fn(),
    },
    taskAssignee: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    membership: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  } as unknown as PrismaService;

  const mockNotes = {
    syncTaskStatusToNote: jest.fn(),
  };
  const mockIntegration = {
    sendNotification: jest.fn(),
  };
  const mockNotifications = {};
  const mockPermissions = {
    assertProjectRole: jest.fn(),
    logAction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotesService, useValue: mockNotes },
        { provide: IntegrationService, useValue: mockIntegration },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ProjectPermissionsService, useValue: mockPermissions },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    jest.clearAllMocks();
  });

  describe('getCriticalPath', () => {
    it('devrait retourner le chemin critique exact pour un ensemble de tâches linéaires', async () => {
      // Tâche A (120m) -> Tâche B (60m) -> Tâche C (180m)
      const mockTasks = [
        {
          id: 'task-a',
          estimatedMinutes: 120,
          dependencies: [],
        },
        {
          id: 'task-b',
          estimatedMinutes: 60,
          dependencies: [{ dependsOnTaskId: 'task-a' }],
        },
        {
          id: 'task-c',
          estimatedMinutes: 180,
          dependencies: [{ dependsOnTaskId: 'task-b' }],
        },
      ];

      (mockPrisma.task.findMany as jest.Mock).mockResolvedValue(mockTasks);
      mockPermissions.assertProjectRole.mockResolvedValue(true);

      const result = await service.getCriticalPath('project-1', 'user-1');

      // Dans un graphe linéaire simple, toutes les tâches sont critiques
      expect(result.criticalTaskIds.sort()).toEqual(['task-a', 'task-b', 'task-c'].sort());
      expect(result.slacks['task-a']).toBe(0);
      expect(result.slacks['task-b']).toBe(0);
      expect(result.slacks['task-c']).toBe(0);
    });

    it('devrait calculer correctement la marge pour une tâche non critique en parallèle', async () => {
      // Tâche A (100m) -> Tâche B (100m)
      // Tâche A (100m) -> Tâche C (50m) -> Tâche B (100m)
      // Ici le chemin A -> B fait 200m de durée totale.
      // Le chemin A -> C -> B fait 250m de durée totale.
      // Le chemin critique est donc A -> C -> B.
      // La tâche A et B ont une marge de 0.
      // La tâche C a une marge de 0 (car elle est sur le chemin critique).
      // Attendez :
      // A (100) -> B (100)
      // A (100) -> C (50)
      // Et pas d'autres relations.
      // Projet finit quand toutes les tâches terminent.
      // Chemin 1: A (100) -> B (100) = Fin à 200.
      // Chemin 2: A (100) -> C (50) = Fin à 150.
      // Fin de projet globale = 200 (max EF).
      // LF(B) = 200, LS(B) = 100.
      // LF(C) = 200, LS(C) = 150.
      // ES(C) = 100, EF(C) = 150.
      // Slack(C) = LF(C) - EF(C) = 200 - 150 = 50.
      // Slack(B) = 0.
      // Slack(A) = 0.
      const mockTasks = [
        {
          id: 'task-a',
          estimatedMinutes: 100,
          dependencies: [],
        },
        {
          id: 'task-b',
          estimatedMinutes: 100,
          dependencies: [{ dependsOnTaskId: 'task-a' }],
        },
        {
          id: 'task-c',
          estimatedMinutes: 50,
          dependencies: [{ dependsOnTaskId: 'task-a' }],
        },
      ];

      (mockPrisma.task.findMany as jest.Mock).mockResolvedValue(mockTasks);
      mockPermissions.assertProjectRole.mockResolvedValue(true);

      const result = await service.getCriticalPath('project-1', 'user-1');

      expect(result.criticalTaskIds.sort()).toEqual(['task-a', 'task-b'].sort());
      expect(result.slacks['task-c']).toBe(50);
      expect(result.slacks['task-a']).toBe(0);
      expect(result.slacks['task-b']).toBe(0);
    });

    it('devrait lever une BadRequestException si un cycle est détecté', async () => {
      // A -> B -> A
      const mockTasks = [
        {
          id: 'task-a',
          estimatedMinutes: 100,
          dependencies: [{ dependsOnTaskId: 'task-b' }],
        },
        {
          id: 'task-b',
          estimatedMinutes: 100,
          dependencies: [{ dependsOnTaskId: 'task-a' }],
        },
      ];

      (mockPrisma.task.findMany as jest.Mock).mockResolvedValue(mockTasks);
      mockPermissions.assertProjectRole.mockResolvedValue(true);

      await expect(service.getCriticalPath('project-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateTask - Règles de synchronisation OODA', () => {
    it('Règle 1 : devrait affecter startDate et dueDate par défaut si statut passe à IN_PROGRESS et dates vides', async () => {
      const mockTask = {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Tâche Test',
        status: 'TODO',
        startDate: null,
        dueDate: null,
        project: { workspaceId: 'ws-1', name: 'Projet 1' },
      };

      mockPrisma.task.findFirst = jest.fn().mockResolvedValue(mockTask);
      mockPermissions.assertProjectRole.mockResolvedValue(true);

      mockPrisma.task.update = jest.fn().mockImplementation(({ data }) => ({
        ...mockTask,
        ...data,
      }));
      mockPrisma.task.findUnique = jest.fn().mockImplementation(() => ({
        ...mockTask,
        status: 'IN_PROGRESS',
        startDate: new Date(),
        dueDate: new Date(),
      }));
      mockPrisma.taskDependency.findMany = jest.fn().mockResolvedValue([]);
      mockPrisma.taskAssignee.deleteMany = jest.fn().mockResolvedValue(true);
      mockPrisma.membership.findMany = jest.fn().mockResolvedValue([]);

      const result = await service.updateTask('task-1', 'user-1', { status: 'IN_PROGRESS' });

      expect(result.startDate).toBeDefined();
      expect(result.dueDate).toBeDefined();
    });

    it('Règle 2 : devrait passer le statut à IN_PROGRESS si startDate est configurée dans le passé ou présent et statut est TODO', async () => {
      const mockTask = {
        id: 'task-2',
        projectId: 'project-1',
        title: 'Tâche Test 2',
        status: 'TODO',
        startDate: null,
        dueDate: null,
        project: { workspaceId: 'ws-1', name: 'Projet 1' },
      };

      mockPrisma.task.findFirst = jest.fn().mockResolvedValue(mockTask);
      mockPermissions.assertProjectRole.mockResolvedValue(true);

      let updatedData: Record<string, unknown> = {};
      mockPrisma.task.update = jest.fn().mockImplementation(({ data }) => {
        updatedData = data;
        return {
          ...mockTask,
          ...data,
        };
      });
      mockPrisma.task.findUnique = jest.fn().mockImplementation(() => ({
        ...mockTask,
        ...updatedData,
      }));
      mockPrisma.taskDependency.findMany = jest.fn().mockResolvedValue([]);
      mockPrisma.taskAssignee.deleteMany = jest.fn().mockResolvedValue(true);
      mockPrisma.membership.findMany = jest.fn().mockResolvedValue([]);

      const todayStr = new Date().toISOString();
      const result = await service.updateTask('task-2', 'user-1', { startDate: todayStr });

      expect(result.status).toBe('IN_PROGRESS');
    });
  });
});
