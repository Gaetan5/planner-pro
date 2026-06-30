import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TimeBlocksService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.timeBlock.create({
      data: {
        taskId,
        startTime,
        endTime,
      },
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

    return this.prisma.timeBlock.update({
      where: { id: timeBlockId },
      data: {
        startTime,
        endTime,
      },
    });
  }

  async deleteTimeBlock(timeBlockId: string, userId: string) {
    await this.assertTimeBlockAccess(timeBlockId, userId);

    return this.prisma.timeBlock.delete({
      where: { id: timeBlockId },
    });
  }
}
