import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';

@Injectable()
export class TimeBlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firestoreSync: FirestoreSyncService,
  ) {}

  private async assertTaskAccess(taskId: string, userId: string) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [{ userId }, { project: { workspace: { memberships: { some: { userId } } } } }],
      },
    });
    if (!task) {
      throw new BadRequestException('Task not found or unauthorized');
    }
    return task;
  }

  private async assertTimeBlockAccess(timeBlockId: string, userId: string) {
    const timeBlock = await this.prisma.timeBlock.findFirst({
      where: {
        id: timeBlockId,
        task: {
          deletedAt: null,
          OR: [{ userId }, { project: { workspace: { memberships: { some: { userId } } } } }],
        },
      },
    });
    if (!timeBlock) {
      throw new BadRequestException('Time block not found or unauthorized');
    }
    return timeBlock;
  }

  async createTimeBlock(taskId: string, userId: string, startTime: Date, endTime: Date) {
    await this.assertTaskAccess(taskId, userId);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.timeBlock.create({
        data: { taskId, startTime, endTime },
      });
      const task = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { userId: true, projectId: true, project: { select: { workspaceId: true } } },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'timeBlock',
        entityId: created.id,
        workspaceId: task.project?.workspaceId ?? `personal-${task.userId}`,
        operation: 'upsert',
        payload: {
          id: created.id,
          taskId: created.taskId,
          projectId: task.projectId,
          startTime: created.startTime.toISOString(),
          endTime: created.endTime.toISOString(),
        },
      });
      return created;
    });
  }

  async getTimeBlocks(userId: string, start?: Date, end?: Date) {
    return this.prisma.timeBlock.findMany({
      where: {
        task: {
          deletedAt: null,
          OR: [{ userId }, { project: { workspace: { memberships: { some: { userId } } } } }],
        },
        ...(start || end
          ? {
              startTime: {
                ...(start ? { gte: start } : {}),
                ...(end ? { lt: end } : {}),
              },
            }
          : {}),
      },
      include: {
        task: {
          include: {
            project: true,
            assignees: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });
  }

  async updateTimeBlock(timeBlockId: string, userId: string, startTime: Date, endTime: Date) {
    await this.assertTimeBlockAccess(timeBlockId, userId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.timeBlock.update({
        where: { id: timeBlockId },
        data: { startTime, endTime },
      });
      const task = await tx.task.findUniqueOrThrow({
        where: { id: updated.taskId },
        select: { userId: true, projectId: true, project: { select: { workspaceId: true } } },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'timeBlock',
        entityId: updated.id,
        workspaceId: task.project?.workspaceId ?? `personal-${task.userId}`,
        operation: 'upsert',
        payload: {
          id: updated.id,
          taskId: updated.taskId,
          projectId: task.projectId,
          startTime: updated.startTime.toISOString(),
          endTime: updated.endTime.toISOString(),
        },
      });
      return updated;
    });
  }

  async deleteTimeBlock(timeBlockId: string, userId: string) {
    await this.assertTimeBlockAccess(timeBlockId, userId);

    return this.prisma.$transaction(async (tx) => {
      const block = await tx.timeBlock.findUniqueOrThrow({
        where: { id: timeBlockId },
        include: { task: { include: { project: { select: { workspaceId: true } } } } },
      });
      const deleted = await tx.timeBlock.delete({ where: { id: timeBlockId } });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'timeBlock',
        entityId: deleted.id,
        workspaceId: block.task.project?.workspaceId ?? `personal-${block.task.userId}`,
        operation: 'delete',
        payload: {
          id: deleted.id,
          taskId: deleted.taskId,
          projectId: block.task.projectId,
          startTime: block.startTime.toISOString(),
          endTime: block.endTime.toISOString(),
        },
      });
      return deleted;
    });
  }
}
