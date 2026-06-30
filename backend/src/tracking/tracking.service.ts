import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.timeLog.create({
      data: {
        startTime: new Date(),
        taskId,
      },
      include: {
        task: true,
      },
    });
  }

  async stopActiveTracking(userId: string) {
    // Trouver le log actif (où endTime est null) pour cet utilisateur
    const activeLog = await this.prisma.timeLog.findFirst({
      where: {
        endTime: null,
        task: {
          userId,
        },
      },
    });

    if (!activeLog) {
      return null;
    }

    const endTime = new Date();
    const duration = Math.floor((endTime.getTime() - activeLog.startTime.getTime()) / 1000);

    return this.prisma.timeLog.update({
      where: { id: activeLog.id },
      data: {
        endTime,
        duration,
      },
      include: {
        task: true,
      },
    });
  }

  async getActiveTracking(userId: string) {
    return this.prisma.timeLog.findFirst({
      where: {
        endTime: null,
        task: {
          userId,
        },
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
        task: {
          userId,
        },
      },
      include: {
        task: true,
      },
      orderBy: { startTime: 'desc' },
    });
  }
}
