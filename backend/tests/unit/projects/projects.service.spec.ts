import { PolicyService } from '../../../src/authz/policy.service';
import { RealtimeService } from '../../../src/realtime/realtime.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from '../../../src/projects/projects.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { NotesService } from '../../../src/notes/notes.service';
import { IntegrationService } from '../../../src/projects/integration.service';
import { TasksService } from '../../../src/projects/tasks.service';
import { DependenciesService } from '../../../src/projects/dependencies.service';
import { TimeBlocksService } from '../../../src/projects/timeblocks.service';
import { MilestonesService } from '../../../src/projects/milestones.service';
import { ResourcesService } from '../../../src/projects/resources.service';
import { FinancesService } from '../../../src/projects/finances.service';
import { ProjectPermissionsService } from '../../../src/projects/project-permissions.service';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';

describe('ProjectsService', () => {
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
        PolicyService,
        ProjectsService,
        { provide: RealtimeService, useValue: { refreshWorkspaceManagersRooms: jest.fn() } },
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
        { provide: FirestoreSyncService, useValue: { enqueue: jest.fn() } },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    prisma = module.get<PrismaService>(PrismaService);
    notesService = module.get<NotesService>(NotesService);

    jest.clearAllMocks();
  });

  describe('optimizeWorkspaceResources (délégation)', () => {
    const workspaceId = 'workspace-123';
    const userId = 'user-owner';

    it("devrait déléguer l'optimisation à ResourcesService", async () => {
      const mockResult = {
        success: true,
        message: 'Optimisation réussie. 3 tâches réallouées.',
        reallocatedCount: 3,
        reallocatedTaskIds: ['task-1', 'task-2', 'task-3'],
      };
      mockResourcesService.optimizeWorkspaceResources.mockResolvedValue(mockResult);

      const result = await service.optimizeWorkspaceResources(workspaceId, userId);

      expect(result).toEqual(mockResult);
      expect(mockResourcesService.optimizeWorkspaceResources).toHaveBeenCalledWith(
        workspaceId,
        userId,
      );
    });
  });

  describe('Délégation Tasks, Dependencies, TimeBlocks, Milestones, Finances', () => {
    it('devrait déléguer createTask à TasksService', async () => {
      mockTasksService.createTask.mockResolvedValue({ id: 'task-new' });
      await service.createTask('proj-1', 'user-1', 'Test');
      expect(mockTasksService.createTask).toHaveBeenCalledWith(
        'proj-1',
        'user-1',
        'Test',
        undefined,
        undefined,
        undefined,
      );
    });

    it('devrait déléguer addTaskDependency à DependenciesService', async () => {
      mockDependenciesService.addTaskDependency.mockResolvedValue({ id: 'dep-1' });
      await service.addTaskDependency('task-1', 'user-1', 'task-2');
      expect(mockDependenciesService.addTaskDependency).toHaveBeenCalledWith(
        'task-1',
        'user-1',
        'task-2',
        undefined,
      );
    });

    it('devrait déléguer createTimeBlock à TimeBlocksService', async () => {
      const start = new Date();
      const end = new Date(start.getTime() + 3600000);
      mockTimeBlocksService.createTimeBlock.mockResolvedValue({ id: 'tb-1' });
      await service.createTimeBlock('task-1', 'user-1', start, end);
      expect(mockTimeBlocksService.createTimeBlock).toHaveBeenCalledWith(
        'task-1',
        'user-1',
        start,
        end,
      );
    });

    it('devrait déléguer getProjectFinances à FinancesService', async () => {
      mockFinancesService.getProjectFinances.mockResolvedValue({
        projectId: 'proj-1',
        actualCostCents: 5000,
      });
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
