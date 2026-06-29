import { Test, TestingModule } from '@nestjs/testing';
import { SprintService } from '../../../src/projects/sprint.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { SprintStatus } from '@prisma/client';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';

describe('SprintService', () => {
  let service: SprintService;
  let prisma: PrismaService;

  const mockPrisma = {
    membership: {
      findFirst: jest.fn(),
    },
    sprint: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    task: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SprintService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SprintService>(SprintService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('createSprint', () => {
    const workspaceId = 'ws-123';
    const userId = 'user-123';

    it('devrait créer un sprint avec succès', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'mem-1' });
      const sprintData = {
        name: 'Sprint 1',
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-14T23:59:59.000Z',
      };
      const createdSprint = { id: 'sprint-1', ...sprintData, status: SprintStatus.PLANNED, workspaceId };
      mockPrisma.sprint.create.mockResolvedValue(createdSprint);

      const result = await service.createSprint(workspaceId, userId, sprintData);

      expect(result).toEqual(createdSprint);
      expect(mockPrisma.membership.findFirst).toHaveBeenCalledWith({
        where: { workspaceId, userId, workspace: { deletedAt: null } },
      });
      expect(mockPrisma.sprint.create).toHaveBeenCalled();
    });

    it('devrait rejeter si l\'utilisateur n\'est pas membre', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(null);

      await expect(
        service.createSprint(workspaceId, userId, {
          name: 'Sprint 1',
          startDate: '2026-06-01T00:00:00.000Z',
          endDate: '2026-06-14T23:59:59.000Z',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('devrait rejeter si la date de début est après la date de fin', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'mem-1' });

      await expect(
        service.createSprint(workspaceId, userId, {
          name: 'Sprint 1',
          startDate: '2026-06-15T00:00:00.000Z',
          endDate: '2026-06-14T23:59:59.000Z',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateSprint - Clôture de sprint', () => {
    const sprintId = 'sprint-1';
    const userId = 'user-123';

    it('devrait libérer les tâches non terminées lors de la clôture', async () => {
      const existingSprint = {
        id: sprintId,
        name: 'Sprint Actif',
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-14'),
        status: SprintStatus.ACTIVE,
        workspaceId: 'ws-123',
      };
      mockPrisma.sprint.findUnique.mockResolvedValue(existingSprint);
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'mem-1' });
      mockPrisma.sprint.update.mockResolvedValue({ ...existingSprint, status: SprintStatus.COMPLETED });

      const result = await service.updateSprint(sprintId, userId, { status: SprintStatus.COMPLETED });

      expect(result.status).toEqual(SprintStatus.COMPLETED);
      // Devrait appeler updateMany pour réinitialiser sprintId = null pour les tâches non terminées
      expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
        where: {
          sprintId,
          status: { not: 'DONE' },
          deletedAt: null,
        },
        data: {
          sprintId: null,
        },
      });
    });
  });

  describe('associateTasksToSprint', () => {
    const sprintId = 'sprint-1';
    const userId = 'user-123';
    const taskIds = ['task-1', 'task-2'];

    it('devrait associer les tâches avec succès', async () => {
      const sprint = { id: sprintId, workspaceId: 'ws-123' };
      mockPrisma.sprint.findUnique.mockResolvedValue(sprint);
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'mem-1' });

      await service.associateTasksToSprint(sprintId, taskIds, userId);

      expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: taskIds },
          deletedAt: null,
        },
        data: {
          sprintId,
        },
      });
    });
  });

  describe('getAverageVelocity', () => {
    const workspaceId = 'ws-123';
    const userId = 'user-123';

    it('devrait calculer la vélocité moyenne correctement', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'mem-1' });
      const completedSprints = [
        {
          id: 'sprint-1',
          tasks: [{ storyPoints: 5 }, { storyPoints: 8 }],
        },
        {
          id: 'sprint-2',
          tasks: [{ storyPoints: 3 }, { storyPoints: 5 }],
        },
      ];
      mockPrisma.sprint.findMany.mockResolvedValue(completedSprints);

      const velocity = await service.getAverageVelocity(workspaceId, userId);

      // (13 + 8) / 2 = 10.5
      expect(velocity).toEqual(10.5);
    });

    it('devrait retourner 0 s\'il n\'y a pas de sprints complétés', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'mem-1' });
      mockPrisma.sprint.findMany.mockResolvedValue([]);

      const velocity = await service.getAverageVelocity(workspaceId, userId);

      expect(velocity).toEqual(0);
    });
  });

  describe('getBurndownChart', () => {
    const sprintId = 'sprint-1';
    const userId = 'user-123';

    it('devrait générer les points de burndown corrects', async () => {
      const sprint = {
        id: sprintId,
        name: 'Sprint 1',
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-03T23:59:59.000Z'), // 3 jours
        workspaceId: 'ws-123',
      };
      mockPrisma.sprint.findUnique.mockResolvedValue(sprint);
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'mem-1' });

      const tasks = [
        { id: 'task-1', storyPoints: 5, status: 'DONE', completedAt: new Date('2026-06-02T12:00:00.000Z') },
        { id: 'task-2', storyPoints: 8, status: 'DONE', completedAt: new Date('2026-06-03T15:00:00.000Z') },
        { id: 'task-3', storyPoints: 3, status: 'TODO', completedAt: null },
      ];
      mockPrisma.task.findMany.mockResolvedValue(tasks);

      const burndown = await service.getBurndownChart(sprintId, userId);

      expect(burndown.totalPoints).toEqual(16); // 5 + 8 + 3
      expect(burndown.data).toHaveLength(3);

      // Jour 1 (2026-06-01) : aucune tâche terminée
      expect(burndown.data[0].real).toEqual(16);
      expect(burndown.data[0].ideal).toEqual(16);

      // Jour 2 (2026-06-02) : task-1 terminée (5 SP en moins)
      expect(burndown.data[1].real).toEqual(11); // 16 - 5
      expect(burndown.data[1].ideal).toEqual(8); // Idéal à mi-chemin

      // Jour 3 (2026-06-03) : task-1 et task-2 terminées (13 SP en moins)
      expect(burndown.data[2].real).toEqual(3); // Reste task-3 (3 SP)
      expect(burndown.data[2].ideal).toEqual(0); // Idéal à la fin
    });
  });
});
