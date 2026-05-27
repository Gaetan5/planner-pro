import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotesService } from '../notes/notes.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notesService: NotesService,
  ) {}

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
      where: { userId, deletedAt: null },
      include: {
        tasks: {
          where: { deletedAt: null },
        },
      },
    });
  }

  async getProject(projectId: string) {
    return this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: {
        tasks: {
          where: { deletedAt: null },
        },
      },
    });
  }

  async deleteProject(projectId: string) {
    await this.prisma.task.updateMany({
      where: { projectId },
      data: { deletedAt: new Date() },
    });
    return this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
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
      where: { projectId, deletedAt: null },
    });
  }

  async updateTask(taskId: string, data: { title?: string; description?: string; status?: string; priority?: string }) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
    });
    if (!task) {
      throw new Error('Task not found or deleted');
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data,
    });

    if ((data.status || data.title) && updatedTask.noteId) {
      await this.notesService.syncTaskStatusToNote(taskId, updatedTask.status);
    }

    return updatedTask;
  }

  async deleteTask(taskId: string) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: { deletedAt: new Date() },
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
          deletedAt: null,
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
