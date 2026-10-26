import { Test, TestingModule } from '@nestjs/testing';
import { FinancesService } from '../../../src/projects/finances.service';
import { MilestonesService } from '../../../src/projects/milestones.service';
import { DependenciesService } from '../../../src/projects/dependencies.service';
import { TimeBlocksService } from '../../../src/projects/timeblocks.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { WorkspaceRole, DeliverableStatus } from '@prisma/client';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';

describe('Projects Modular Subservices', () => {
  let financesService: FinancesService;
  let milestonesService: MilestonesService;
  let dependenciesService: DependenciesService;
  let timeBlocksService: TimeBlocksService;
  let prisma: PrismaService;

  const mockPrisma = {
    $transaction: jest.fn(),
    membership: {
      findFirst: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    timeLog: {
      findMany: jest.fn(),
    },
    resourceProfile: {
      findMany: jest.fn(),
    },
    milestone: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    deliverable: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    timeBlock: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    taskDependency: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    task: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const mockFirestoreSync = { enqueue: jest.fn() };

  beforeEach(async () => {
    mockPrisma.$transaction.mockImplementation((callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancesService,
        MilestonesService,
        DependenciesService,
        TimeBlocksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FirestoreSyncService, useValue: mockFirestoreSync },
      ],
    }).compile();

    financesService = module.get<FinancesService>(FinancesService);
    milestonesService = module.get<MilestonesService>(MilestonesService);
    dependenciesService = module.get<DependenciesService>(DependenciesService);
    timeBlocksService = module.get<TimeBlocksService>(TimeBlocksService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('FinancesService', () => {
    it('devrait calculer correctement le burn rate et la marge pour un projet Time & Materials', async () => {
      // 1. Mock du projet
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        name: 'Projet Test',
        workspaceId: 'workspace-1',
        budgetCents: 1000000, // 10,000 $
        billingType: 'TIME_AND_MATERIALS',
        deletedAt: null,
      });

      // 2. Mock du rôle d'administration de l'utilisateur
      mockPrisma.membership.findFirst.mockResolvedValue({
        id: 'memb-1',
        workspaceId: 'workspace-1',
        userId: 'user-admin',
        role: WorkspaceRole.ADMIN,
      });

      // 3. Mock des TimeLogs (2 heures d'Alice et 3 de Bob)
      mockPrisma.timeLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          duration: 7200, // 2h
          userId: 'alice',
          task: { userId: 'alice' },
        },
        {
          id: 'log-2',
          duration: 10800, // 3h
          userId: 'bob',
          task: { userId: 'bob' },
        },
      ]);

      // 4. Mock des profils de ressources (Alice coûte 50$/h et facture 100$/h, Bob 40$/h et facture 80$/h)
      mockPrisma.resourceProfile.findMany.mockResolvedValue([
        { userId: 'alice', costRateCents: 5000, billingRateCents: 10000 },
        { userId: 'bob', costRateCents: 4000, billingRateCents: 8000 },
      ]);

      const result = await financesService.getProjectFinances('proj-1', 'user-admin');

      expect(result).toBeDefined();
      expect(result.projectId).toBe('proj-1');
      // Coût : (2 * 50$) + (3 * 40$) = 220$ = 22000 cents
      expect(result.actualCostCents).toBe(22000);
      // Revenu : (2 * 100$) + (3 * 80$) = 440$ = 44000 cents
      expect(result.actualRevenueCents).toBe(44000);
      // Marge : 440$ - 220$ = 220$
      expect(result.marginCents).toBe(22000);
      expect(result.marginPercent).toBe(50);
      // Burn rate : 220$ / 10000$ = 2.2% = 2% arrondi
      expect(result.burnPercent).toBe(2);
    });

    it("devrait lever une ForbiddenException si l'utilisateur connecté est simple VIEWER", async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        workspaceId: 'workspace-1',
        deletedAt: null,
      });

      mockPrisma.membership.findFirst.mockResolvedValue({
        id: 'memb-1',
        workspaceId: 'workspace-1',
        userId: 'user-viewer',
        role: WorkspaceRole.VIEWER,
      });

      await expect(financesService.getProjectFinances('proj-1', 'user-viewer')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('MilestonesService', () => {
    it("devrait créer un jalon avec succès si l'utilisateur possède les permissions nécessaires", async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        workspaceId: 'workspace-1',
        deletedAt: null,
      });

      mockPrisma.membership.findFirst.mockResolvedValue({
        id: 'memb-1',
        workspaceId: 'workspace-1',
        userId: 'user-owner',
        role: WorkspaceRole.OWNER,
      });

      mockPrisma.milestone.create.mockResolvedValue({
        id: 'mil-1',
        name: 'Jalon MVP',
        projectId: 'proj-1',
        createdAt: new Date(),
      });

      const result = await milestonesService.createMilestone('proj-1', 'user-owner', 'Jalon MVP');

      expect(result).toBeDefined();
      expect(result.name).toBe('Jalon MVP');
      expect(mockPrisma.milestone.create).toHaveBeenCalled();
      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'milestone',
          entityId: 'mil-1',
          workspaceId: 'workspace-1',
          operation: 'upsert',
        }),
      );
    });

    it('devrait générer un rapport de livraison cohérent', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        name: 'Projet Test',
        status: 'ACTIVE',
        tasks: [
          { id: 'task-1', status: 'DONE', timeLogs: [{ duration: 3600 }] },
          { id: 'task-2', status: 'TODO', timeLogs: [] },
        ],
        milestones: [{ id: 'mil-1', completedAt: new Date() }],
        deliverables: [{ id: 'del-1', status: DeliverableStatus.ACCEPTED }],
        deliveries: [],
      });

      const result = await milestonesService.getDeliveryReport('proj-1', 'user-any');

      expect(result).toBeDefined();
      expect(result.tasks.total).toBe(2);
      expect(result.tasks.completed).toBe(1);
      expect(result.tasks.completionRate).toBe(50);
      expect(result.milestones.completed).toBe(1);
      expect(result.deliverables.accepted).toBe(1);
      expect(result.time.trackedHours).toBe(1);
    });
  });

  describe('TimeBlocksService', () => {
    it('devrait créer un bloc horaire avec succès', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        projectId: 'proj-1',
        project: { workspaceId: 'workspace-1' },
      });

      mockPrisma.membership.findFirst.mockResolvedValue({
        id: 'memb-1',
        workspaceId: 'workspace-1',
        userId: 'user-member',
        role: WorkspaceRole.MEMBER,
      });

      mockPrisma.timeBlock.create.mockResolvedValue({
        id: 'tb-1',
        taskId: 'task-1',
        startTime: new Date(),
        endTime: new Date(),
      });
      mockPrisma.task.findUniqueOrThrow.mockResolvedValue({
        userId: 'user-owner',
        projectId: 'proj-1',
        project: { workspaceId: 'workspace-1' },
      });

      const start = new Date();
      const end = new Date(start.getTime() + 7200000);
      const result = await timeBlocksService.createTimeBlock('task-1', 'user-member', start, end);

      expect(result).toBeDefined();
      expect(result.id).toBe('tb-1');
      expect(mockPrisma.timeBlock.create).toHaveBeenCalled();
      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'timeBlock',
          workspaceId: 'workspace-1',
          operation: 'upsert',
        }),
      );
    });

    it('devrait synchroniser les mises à jour et suppressions de blocs horaires', async () => {
      mockPrisma.timeBlock.findFirst.mockResolvedValue({ id: 'tb-1' });
      mockPrisma.timeBlock.update.mockResolvedValue({
        id: 'tb-1',
        taskId: 'task-1',
        startTime: new Date('2026-10-01T09:00:00.000Z'),
        endTime: new Date('2026-10-01T10:00:00.000Z'),
      });
      mockPrisma.task.findUniqueOrThrow.mockResolvedValue({
        userId: 'user-owner',
        projectId: 'proj-1',
        project: { workspaceId: 'workspace-1' },
      });

      await timeBlocksService.updateTimeBlock(
        'tb-1',
        'user-member',
        new Date('2026-10-01T09:00:00.000Z'),
        new Date('2026-10-01T10:00:00.000Z'),
      );

      expect(mockFirestoreSync.enqueue).toHaveBeenLastCalledWith(
        mockPrisma,
        expect.objectContaining({ entityType: 'timeBlock', operation: 'upsert' }),
      );

      mockPrisma.timeBlock.findUniqueOrThrow.mockResolvedValue({
        id: 'tb-1',
        taskId: 'task-1',
        startTime: new Date('2026-10-01T09:00:00.000Z'),
        endTime: new Date('2026-10-01T10:00:00.000Z'),
        task: {
          userId: 'user-owner',
          projectId: 'proj-1',
          project: { workspaceId: 'workspace-1' },
        },
      });
      mockPrisma.timeBlock.delete.mockResolvedValue({
        id: 'tb-1',
        taskId: 'task-1',
        startTime: new Date('2026-10-01T09:00:00.000Z'),
        endTime: new Date('2026-10-01T10:00:00.000Z'),
      });

      await timeBlocksService.deleteTimeBlock('tb-1', 'user-member');

      expect(mockFirestoreSync.enqueue).toHaveBeenLastCalledWith(
        mockPrisma,
        expect.objectContaining({ entityType: 'timeBlock', operation: 'delete' }),
      );
    });
  });

  describe('DependenciesService', () => {
    it('devrait écrire les créations et suppressions de dépendances dans l’outbox', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        userId: 'user-owner',
        projectId: 'proj-1',
        project: { workspaceId: 'workspace-1' },
      });
      mockPrisma.taskDependency.findMany.mockResolvedValue([]);
      mockPrisma.taskDependency.create.mockResolvedValue({
        id: 'dependency-1',
        taskId: 'task-1',
        dependsOnTaskId: 'task-2',
        type: 'FINISH_TO_START',
        createdAt: new Date('2026-10-01T09:00:00.000Z'),
      });

      await dependenciesService.addTaskDependency('task-1', 'user-member', 'task-2');

      expect(mockFirestoreSync.enqueue).toHaveBeenLastCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'taskDependency',
          workspaceId: 'workspace-1',
          operation: 'upsert',
        }),
      );

      mockPrisma.taskDependency.findFirst.mockResolvedValue({
        id: 'dependency-1',
        taskId: 'task-1',
        dependsOnTaskId: 'task-2',
      });
      mockPrisma.taskDependency.delete.mockResolvedValue({
        id: 'dependency-1',
        taskId: 'task-1',
        dependsOnTaskId: 'task-2',
        type: 'FINISH_TO_START',
        createdAt: new Date('2026-10-01T09:00:00.000Z'),
      });
      mockPrisma.task.findUniqueOrThrow.mockResolvedValue({
        id: 'task-1',
        userId: 'user-owner',
        projectId: 'proj-1',
        project: { workspaceId: 'workspace-1' },
      });

      await dependenciesService.removeTaskDependency('task-1', 'user-member', 'task-2');

      expect(mockFirestoreSync.enqueue).toHaveBeenLastCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'taskDependency',
          workspaceId: 'workspace-1',
          operation: 'delete',
        }),
      );
    });
  });
});
