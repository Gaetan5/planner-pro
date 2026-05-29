import { Test, TestingModule } from '@nestjs/testing';
import { TrackingService } from './tracking.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('TrackingService', () => {
  let service: TrackingService;
  let prisma: PrismaService;

  const mockPrisma = {
    task: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    timeLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TrackingService>(TrackingService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('startTracking', () => {
    it('devrait lever une BadRequestException si la tâche n\'existe pas ou si l\'utilisateur n\'y a pas accès', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.startTracking('user-123', 'task-456')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'task-456',
          deletedAt: null,
          OR: [
            { userId: 'user-123' },
            { project: { workspace: { memberships: { some: { userId: 'user-123' } } } } },
          ],
        },
      });
    });

    it('devrait démarrer le chronomètre et créer un TimeLog si la tâche est accessible', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({ id: 'task-456', userId: 'user-123' });
      mockPrisma.timeLog.findFirst.mockResolvedValue(null); // Pas de session active
      mockPrisma.timeLog.create.mockResolvedValue({ id: 'log-789', taskId: 'task-456' });

      const result = await service.startTracking('user-123', 'task-456');

      expect(result).toEqual({ id: 'log-789', taskId: 'task-456' });
      expect(mockPrisma.timeLog.create).toHaveBeenCalled();
    });
  });

  describe('getTimeLogsForTask', () => {
    it('devrait lever une BadRequestException si l\'accès à la tâche n\'est pas autorisé pour l\'utilisateur', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.getTimeLogsForTask('user-123', 'task-456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('devrait renvoyer les logs de la tâche si l\'utilisateur y a accès', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({ id: 'task-456', userId: 'user-123' });
      mockPrisma.timeLog.findMany.mockResolvedValue([{ id: 'log-789', duration: 120 }]);

      const result = await service.getTimeLogsForTask('user-123', 'task-456');

      expect(result).toEqual([{ id: 'log-789', duration: 120 }]);
      expect(mockPrisma.timeLog.findMany).toHaveBeenCalledWith({
        where: { taskId: 'task-456' },
        orderBy: { startTime: 'desc' },
      });
    });
  });
});
