import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firestoreSync: FirestoreSyncService,
  ) {}

  async startTracking(userId: string, taskId: string) {
    // Vérifier si la tâche existe et si l'utilisateur y a accès
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [{ userId }, { project: { workspace: { memberships: { some: { userId } } } } }],
      },
    });
    if (!task) {
      throw new BadRequestException("La tâche spécifiée n'existe pas ou vous n'y avez pas accès.");
    }

    // Arrêter automatiquement toute session de tracking en cours pour cet utilisateur
    await this.stopActiveTracking(userId);

    // Créer la nouvelle session de tracking
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.timeLog.create({
        data: {
          startTime: new Date(),
          taskId,
          userId,
        },
        include: {
          task: {
            include: { project: { select: { workspaceId: true, userId: true } } },
          },
        },
      });

      const workspaceId =
        created.task?.project?.workspaceId ?? `personal-${created.task?.project?.userId ?? userId}`;
      await this.firestoreSync.enqueue(tx, {
        entityType: 'timeLog',
        entityId: created.id,
        workspaceId,
        operation: 'upsert',
        payload: this.timeLogSyncPayload(created),
      });

      return created;
    });
  }

  async stopActiveTracking(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const activeLog = await tx.timeLog.findFirst({
        where: {
          endTime: null,
          OR: [{ userId }, { userId: null, task: { userId } }],
        },
        include: {
          task: {
            include: { project: { select: { workspaceId: true, userId: true } } },
          },
        },
      });

      if (!activeLog) {
        return null;
      }

      const endTime = new Date();
      const duration = Math.floor((endTime.getTime() - activeLog.startTime.getTime()) / 1000);

      const updated = await tx.timeLog.update({
        where: { id: activeLog.id },
        data: {
          endTime,
          duration,
        },
        include: {
          task: true,
        },
      });

      const workspaceId =
        activeLog.task?.project?.workspaceId ??
        `personal-${activeLog.task?.project?.userId ?? userId}`;
      await this.firestoreSync.enqueue(tx, {
        entityType: 'timeLog',
        entityId: updated.id,
        workspaceId,
        operation: 'upsert',
        payload: this.timeLogSyncPayload(updated),
      });

      return updated;
    });
  }

  private timeLogSyncPayload(log: {
    id: string;
    startTime?: Date | string | null;
    endTime?: Date | string | null;
    duration?: number | null;
    taskId: string;
    userId?: string | null;
    createdAt?: Date | string | null;
  }) {
    const startTimeDate = log.startTime ? new Date(log.startTime) : new Date();
    return {
      id: log.id,
      startTime: startTimeDate.toISOString(),
      endTime: log.endTime ? new Date(log.endTime).toISOString() : null,
      duration: log.duration ?? null,
      taskId: log.taskId,
      userId: log.userId ?? null,
      createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : new Date().toISOString(),
    };
  }

  async getActiveTracking(userId: string) {
    return this.prisma.timeLog.findFirst({
      where: {
        endTime: null,
        OR: [{ userId }, { userId: null, task: { userId } }],
      },
      include: {
        task: true,
      },
    });
  }

  async getTimeLogsForTask(userId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [{ userId }, { project: { workspace: { memberships: { some: { userId } } } } }],
      },
    });
    if (!task) {
      throw new BadRequestException("La tâche spécifiée n'existe pas ou vous n'y avez pas accès.");
    }

    return this.prisma.timeLog.findMany({
      where: { taskId },
      orderBy: { startTime: 'desc' },
    });
  }

  async getUserTimeLogs(userId: string) {
    return this.prisma.timeLog.findMany({
      where: {
        OR: [{ userId }, { userId: null, task: { userId } }],
      },
      include: {
        task: true,
      },
      orderBy: { startTime: 'desc' },
    });
  }
}
