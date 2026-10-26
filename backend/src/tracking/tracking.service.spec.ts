/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { TrackingService } from './tracking.service';
import { PrismaService } from '../prisma/prisma.service';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';
import { BadRequestException } from '@nestjs/common';

describe('TrackingService', () => {
  let service: TrackingService;

  const mockPrisma = {
    $transaction: jest.fn(),
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

  const mockFirestoreSync = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    mockPrisma.$transaction.mockImplementation((callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FirestoreSyncService, useValue: mockFirestoreSync },
      ],
    }).compile();

    service = module.get<TrackingService>(TrackingService);

    jest.clearAllMocks();
  });

  describe('startTracking', () => {
    it("devrait lever une BadRequestException si la tâche n'existe pas ou si l'utilisateur n'y a pas accès", async () => {
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
      const mockCreated = {
        id: 'log-789',
        taskId: 'task-456',
        userId: 'user-123',
        startTime: new Date(),
        task: { project: { workspaceId: 'ws-123', userId: 'user-123' } },
      };
      mockPrisma.timeLog.create.mockResolvedValue(mockCreated);

      const result = await service.startTracking('user-123', 'task-456');

      expect(result).toEqual(mockCreated);
      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'timeLog',
          entityId: 'log-789',
          workspaceId: 'ws-123',
          operation: 'upsert',
        }),
      );
      expect(mockPrisma.timeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: 'task-456',
            userId: 'user-123',
          }),
        }),
      );
    });

    it("rattache le suivi à l'utilisateur courant même pour une tâche partagée", async () => {
      mockPrisma.task.findFirst.mockResolvedValue({ id: 'task-shared', userId: 'owner-456' });
      mockPrisma.timeLog.findFirst.mockResolvedValue(null);
      mockPrisma.timeLog.create.mockResolvedValue({ id: 'log-789', taskId: 'task-shared' });

      await service.startTracking('member-123', 'task-shared');

      expect(mockPrisma.timeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: 'task-shared',
            userId: 'member-123',
          }),
        }),
      );
    });
  });

  describe('getTimeLogsForTask', () => {
    it("devrait lever une BadRequestException si l'accès à la tâche n'est pas autorisé pour l'utilisateur", async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.getTimeLogsForTask('user-123', 'task-456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it("devrait renvoyer les logs de la tâche si l'utilisateur y a accès", async () => {
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
