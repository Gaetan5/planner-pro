import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(userId: string, name: string, description?: string) {
    return this.prisma.project.create({
      data: {
        name,
        description,
        userId,
      },
    });
  }

  async getProjects(userId: string) {
    return this.prisma.project.findMany({
      where: { userId },
      include: {
        tasks: true,
      },
    });
  }

  async getProject(projectId: string) {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: true,
      },
    });
  }

  async deleteProject(projectId: string) {
    await this.prisma.task.deleteMany({
      where: { projectId },
    });
    return this.prisma.project.delete({
      where: { id: projectId },
    });
  }

  async createTask(projectId: string, userId: string, title: string, description?: string, priority: string = 'MEDIUM') {
    return this.prisma.task.create({
      data: {
        title,
        description,
        priority,
        projectId,
        userId,
      },
    });
  }

  async getTasks(projectId: string) {
    return this.prisma.task.findMany({
      where: { projectId },
    });
  }

  async updateTask(taskId: string, data: { title?: string; description?: string; status?: string; priority?: string }) {
    return this.prisma.task.update({
      where: { id: taskId },
      data,
    });
  }

  async deleteTask(taskId: string) {
    return this.prisma.task.delete({
      where: { id: taskId },
    });
  }

  async createTimeBlock(taskId: string, startTime: Date, endTime: Date) {
    return this.prisma.timeBlock.create({
      data: {
        taskId,
        startTime,
        endTime,
      },
    });
  }

  async getTimeBlocks(userId: string) {
    return this.prisma.timeBlock.findMany({
      where: {
        task: {
          userId,
        },
      },
      include: {
        task: {
          include: {
            project: true,
          },
        },
      },
    });
  }

  async updateTimeBlock(timeBlockId: string, startTime: Date, endTime: Date) {
    return this.prisma.timeBlock.update({
      where: { id: timeBlockId },
      data: {
        startTime,
        endTime,
      },
    });
  }

  async deleteTimeBlock(timeBlockId: string) {
    return this.prisma.timeBlock.delete({
      where: { id: timeBlockId },
    });
  }
}
