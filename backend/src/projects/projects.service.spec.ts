import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotesService } from '../notes/notes.service';
import { IntegrationService } from './integration.service';
import { TasksService } from './tasks.service';
import { DependenciesService } from './dependencies.service';
import { TimeBlocksService } from './timeblocks.service';
import { MilestonesService } from './milestones.service';
import { ResourcesService } from './resources.service';
import { FinancesService } from './finances.service';
import { ProjectPermissionsService } from './project-permissions.service';
import * as crypto from 'crypto';

describe('ProjectsService - GitHub Webhooks', () => {
  let service: ProjectsService;
  let prisma: PrismaService;
  let notesService: NotesService;

  const mockPrisma = {
    task: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    membership: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    resourceProfile: {
      findMany: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    taskAssignee: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockNotesService = {
    syncTaskStatusToNote: jest.fn(),
  };

  const mockIntegration = {
    sendNotification: jest.fn().mockResolvedValue(undefined),
  };

  const mockTasksService = {
    createTask: jest.fn(),
    getTasks: jest.fn(),
    updateTask: jest.fn(),
    deleteTask: jest.fn(),
    closeTaskFromWebhook: jest.fn(),
  };

  const mockDependenciesService = {
    addTaskDependency: jest.fn(),
    removeTaskDependency: jest.fn(),
  };

  const mockTimeBlocksService = {
    createTimeBlock: jest.fn(),
    getTimeBlocks: jest.fn(),
    updateTimeBlock: jest.fn(),
    deleteTimeBlock: jest.fn(),
  };

  const mockMilestonesService = {
    createMilestone: jest.fn(),
    completeMilestone: jest.fn(),
    createDeliverable: jest.fn(),
    updateDeliverableStatus: jest.fn(),
    createDelivery: jest.fn(),
    updateDeliveryStatus: jest.fn(),
    toggleDeliveryChecklistItem: jest.fn(),
    getDeliveryReport: jest.fn(),
  };

  const mockResourcesService = {
    getResourceCapacityReport: jest.fn(),
    updateResourceProfile: jest.fn(),
    createResourceAllocation: jest.fn(),
    optimizeWorkspaceResources: jest.fn(),
  };

  const mockFinancesService = {
    getProjectFinances: jest.fn(),
    getWorkspaceFinancialSummary: jest.fn(),
  };

  const mockProjectPermissionsService = {
    assertProjectRole: jest.fn(),
    logAction: jest.fn(),
    getAuditLogs: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotesService, useValue: mockNotesService },
        { provide: IntegrationService, useValue: mockIntegration },
        { provide: TasksService, useValue: mockTasksService },
        { provide: DependenciesService, useValue: mockDependenciesService },
        { provide: TimeBlocksService, useValue: mockTimeBlocksService },
        { provide: MilestonesService, useValue: mockMilestonesService },
        { provide: ResourcesService, useValue: mockResourcesService },
        { provide: FinancesService, useValue: mockFinancesService },
        { provide: ProjectPermissionsService, useValue: mockProjectPermissionsService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    prisma = module.get<PrismaService>(PrismaService);
    notesService = module.get<NotesService>(NotesService);

    jest.clearAllMocks();
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  describe('verifyGitHubSignature', () => {
    it('devrait retourner true si aucun secret GITHUB_WEBHOOK_SECRET n\'est défini', async () => {
      // @ts-ignore - accès à une méthode privée pour le test
      const result = service.verifyGitHubSignature({ foo: 'bar' }, 'any-sig');
      expect(result).toBe(true);
    });

    it('devrait retourner false si le secret est défini mais que la signature est absente', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'secret';
      // @ts-ignore
      const result = service.verifyGitHubSignature({ foo: 'bar' });
      expect(result).toBe(false);
    });

    it('devrait retourner true si la signature correspond au HMAC SHA-256 du payload', async () => {
      const secret = 'my-webhook-secret';
      process.env.GITHUB_WEBHOOK_SECRET = secret;
      const payload = { event: 'push', repo: 'planner-pro' };
      const bodyStr = JSON.stringify(payload);
      const hmac = crypto.createHmac('sha256', secret);
      const digest = 'sha256=' + hmac.update(bodyStr).digest('hex');

      // @ts-ignore
      const result = service.verifyGitHubSignature(payload, digest);
      expect(result).toBe(true);
    });

    it('devrait retourner false si la signature ne correspond pas', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'secret';
      // @ts-ignore
      const result = service.verifyGitHubSignature({ foo: 'bar' }, 'sha256=invalid-signature');
      expect(result).toBe(false);
    });
  });

  describe('extractTaskIdsFromText', () => {
    it('devrait extraire les UUIDs précédés des mots-clés de fermeture', () => {
      const taskId1 = 'b406e122-37b4-4b5c-b171-d68a9fdfc418';
      const taskId2 = 'c1234567-89ab-cdef-0123-456789abcdef';
      const text = `Ce commit fixes #${taskId1} et closes #${taskId2}. Ne devrait pas matcher un simple UUID ${taskId1} ou un mot-clé sans hash comme fix #${taskId1.substring(0, 10)}`;
      
      // @ts-ignore
      const result = service.extractTaskIdsFromText(text);
      expect(result).toContain(taskId1);
      expect(result).toContain(taskId2);
      expect(result).toHaveLength(2);
    });

    it('devrait être insensible à la casse pour les mots-clés', () => {
      const taskId = 'b406e122-37b4-4b5c-b171-d68a9fdfc418';
      const text = `FIXES #${taskId} et ClOsEd #${taskId}`;
      // @ts-ignore
      const result = service.extractTaskIdsFromText(text);
      expect(result).toContain(taskId);
    });
  });

  describe('handleGitHubWebhook', () => {
    const mockTaskId = '123e4567-e89b-12d3-a456-426614174000';

    it('devrait fermer la tâche lors d\'une fusion de PR contenant "fixes #UUID"', async () => {
      const payload = {
        action: 'closed',
        pull_request: {
          merged: true,
          title: `Ferme l'anomalie de sécurité`,
          body: `Cette PR fixes #${mockTaskId} de manière définitive.`,
        },
      };

      mockTasksService.closeTaskFromWebhook.mockResolvedValue(true);

      const closedIds = await service.handleGitHubWebhook(payload);

      expect(closedIds).toContain(mockTaskId);
      expect(mockTasksService.closeTaskFromWebhook).toHaveBeenCalledWith(mockTaskId);
    });

    it('devrait fermer les tâches issues de messages de commits lors d\'un push', async () => {
      const payload = {
        commits: [
          { message: `Ajout des tests - closes #${mockTaskId}` },
        ],
      };

      mockTasksService.closeTaskFromWebhook.mockResolvedValue(true);

      const closedIds = await service.handleGitHubWebhook(payload);

      expect(closedIds).toContain(mockTaskId);
      expect(mockTasksService.closeTaskFromWebhook).toHaveBeenCalledWith(mockTaskId);
    });

    it('ne devrait rien faire si la PR est fermée sans être fusionnée', async () => {
      const payload = {
        action: 'closed',
        pull_request: {
          merged: false,
          title: `Tentative ratée de correctif`,
          body: `fixes #${mockTaskId}`,
        },
      };

      const closedIds = await service.handleGitHubWebhook(payload);
      expect(closedIds).toHaveLength(0);
      expect(mockTasksService.closeTaskFromWebhook).not.toHaveBeenCalled();
    });
  });

  describe('optimizeWorkspaceResources (délégation)', () => {
    const workspaceId = 'workspace-123';
    const userId = 'user-owner';

    it('devrait déléguer l\'optimisation à ResourcesService', async () => {
      const mockResult = {
        success: true,
        message: 'Optimisation réussie. 3 tâches réallouées.',
        reallocatedCount: 3,
        reallocatedTaskIds: ['task-1', 'task-2', 'task-3'],
      };
      mockResourcesService.optimizeWorkspaceResources.mockResolvedValue(mockResult);

      const result = await service.optimizeWorkspaceResources(workspaceId, userId);

      expect(result).toEqual(mockResult);
      expect(mockResourcesService.optimizeWorkspaceResources).toHaveBeenCalledWith(workspaceId, userId);
    });
  });

  describe('Délégation Tasks, Dependencies, TimeBlocks, Milestones, Finances', () => {
    it('devrait déléguer createTask à TasksService', async () => {
      mockTasksService.createTask.mockResolvedValue({ id: 'task-new' });
      await service.createTask('proj-1', 'user-1', 'Test');
      expect(mockTasksService.createTask).toHaveBeenCalledWith('proj-1', 'user-1', 'Test', undefined, undefined, undefined);
    });

    it('devrait déléguer addTaskDependency à DependenciesService', async () => {
      mockDependenciesService.addTaskDependency.mockResolvedValue({ id: 'dep-1' });
      await service.addTaskDependency('task-1', 'user-1', 'task-2');
      expect(mockDependenciesService.addTaskDependency).toHaveBeenCalledWith('task-1', 'user-1', 'task-2', undefined);
    });

    it('devrait déléguer createTimeBlock à TimeBlocksService', async () => {
      const start = new Date();
      const end = new Date(start.getTime() + 3600000);
      mockTimeBlocksService.createTimeBlock.mockResolvedValue({ id: 'tb-1' });
      await service.createTimeBlock('task-1', 'user-1', start, end);
      expect(mockTimeBlocksService.createTimeBlock).toHaveBeenCalledWith('task-1', 'user-1', start, end);
    });

    it('devrait déléguer getProjectFinances à FinancesService', async () => {
      mockFinancesService.getProjectFinances.mockResolvedValue({ projectId: 'proj-1', actualCostCents: 5000 });
      await service.getProjectFinances('proj-1', 'user-1');
      expect(mockFinancesService.getProjectFinances).toHaveBeenCalledWith('proj-1', 'user-1');
    });

    it('devrait déléguer getDeliveryReport à MilestonesService', async () => {
      mockMilestonesService.getDeliveryReport.mockResolvedValue({ project: { id: 'proj-1' } });
      await service.getDeliveryReport('proj-1', 'user-1');
      expect(mockMilestonesService.getDeliveryReport).toHaveBeenCalledWith('proj-1', 'user-1');
    });
  });
});
