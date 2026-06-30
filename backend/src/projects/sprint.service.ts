import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SprintStatus, Sprint, Prisma } from '@prisma/client';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';

@Injectable()
export class SprintService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertWorkspaceMember(workspaceId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        workspaceId,
        userId,
        workspace: { deletedAt: null },
      },
    });

    if (!membership) {
      throw new ForbiddenException('Workspace not found or unauthorized');
    }
    return membership;
  }

  async createSprint(workspaceId: string, userId: string, data: CreateSprintDto): Promise<Sprint> {
    await this.assertWorkspaceMember(workspaceId, userId);

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);

    if (start >= end) {
      throw new BadRequestException(
        'La date de début doit être strictement antérieure à la date de fin.',
      );
    }

    return this.prisma.sprint.create({
      data: {
        name: data.name,
        startDate: start,
        endDate: end,
        status: data.status || SprintStatus.PLANNED,
        workspaceId,
      },
    });
  }

  async updateSprint(sprintId: string, userId: string, data: UpdateSprintDto): Promise<Sprint> {
    const sprint = await this.prisma.sprint.findUnique({
      where: { id: sprintId },
    });

    if (!sprint) {
      throw new NotFoundException('Sprint introuvable.');
    }

    await this.assertWorkspaceMember(sprint.workspaceId, userId);

    const updateData: Prisma.SprintUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);

    if (
      updateData.startDate &&
      updateData.endDate &&
      (updateData.startDate as Date) >= (updateData.endDate as Date)
    ) {
      throw new BadRequestException(
        'La date de début doit être strictement antérieure à la date de fin.',
      );
    }

    if (data.status !== undefined) {
      updateData.status = data.status;

      // Logique de transition intelligente si le sprint est clôturé (COMPLETED)
      if (data.status === SprintStatus.COMPLETED && sprint.status !== SprintStatus.COMPLETED) {
        // Déplacer toutes les tâches non terminées de ce sprint vers le backlog (sprintId = null)
        await this.prisma.task.updateMany({
          where: {
            sprintId,
            status: { not: 'DONE' },
            deletedAt: null,
          },
          data: {
            sprintId: null,
          },
        });
      }
    }

    return this.prisma.sprint.update({
      where: { id: sprintId },
      data: updateData,
    });
  }

  async deleteSprint(sprintId: string, userId: string): Promise<Sprint> {
    const sprint = await this.prisma.sprint.findUnique({
      where: { id: sprintId },
    });

    if (!sprint) {
      throw new NotFoundException('Sprint introuvable.');
    }

    await this.assertWorkspaceMember(sprint.workspaceId, userId);

    // Mettre à null le sprintId des tâches liées avant de supprimer
    await this.prisma.task.updateMany({
      where: { sprintId },
      data: { sprintId: null },
    });

    return this.prisma.sprint.delete({
      where: { id: sprintId },
    });
  }

  async listSprints(workspaceId: string, userId: string) {
    await this.assertWorkspaceMember(workspaceId, userId);

    const sprints = await this.prisma.sprint.findMany({
      where: { workspaceId },
      include: {
        tasks: {
          where: { deletedAt: null },
          select: {
            id: true,
            storyPoints: true,
            status: true,
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    return sprints.map((sprint) => {
      const totalPoints = sprint.tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
      const completedPoints = sprint.tasks
        .filter((t) => t.status === 'DONE')
        .reduce((sum, t) => sum + (t.storyPoints || 0), 0);

      return {
        ...sprint,
        totalPoints,
        completedPoints,
      };
    });
  }

  async associateTasksToSprint(
    sprintId: string | null,
    taskIds: string[],
    userId: string,
  ): Promise<void> {
    if (sprintId) {
      const sprint = await this.prisma.sprint.findUnique({
        where: { id: sprintId },
      });
      if (!sprint) {
        throw new NotFoundException('Sprint introuvable.');
      }
      await this.assertWorkspaceMember(sprint.workspaceId, userId);
    }

    // Si pas de sprintId (remise au backlog), on valide l'accès par rapport aux tâches
    if (taskIds.length > 0) {
      const sampleTask = await this.prisma.task.findUnique({
        where: { id: taskIds[0] },
        include: { project: true },
      });
      if (sampleTask?.project?.workspaceId) {
        await this.assertWorkspaceMember(sampleTask.project.workspaceId, userId);
      }
    }

    await this.prisma.task.updateMany({
      where: {
        id: { in: taskIds },
        deletedAt: null,
      },
      data: {
        sprintId,
      },
    });
  }

  async getAverageVelocity(workspaceId: string, userId: string): Promise<number> {
    await this.assertWorkspaceMember(workspaceId, userId);

    const completedSprints = await this.prisma.sprint.findMany({
      where: {
        workspaceId,
        status: SprintStatus.COMPLETED,
      },
      include: {
        tasks: {
          where: {
            deletedAt: null,
            status: 'DONE',
          },
          select: {
            storyPoints: true,
          },
        },
      },
    });

    if (completedSprints.length === 0) {
      return 0;
    }

    const totalPointsCompleted = completedSprints.reduce((sum, sprint) => {
      const sprintPoints = sprint.tasks.reduce(
        (taskSum, task) => taskSum + (task.storyPoints || 0),
        0,
      );
      return sum + sprintPoints;
    }, 0);

    return parseFloat((totalPointsCompleted / completedSprints.length).toFixed(1));
  }

  async getBurndownChart(sprintId: string, userId: string) {
    const sprint = await this.prisma.sprint.findUnique({
      where: { id: sprintId },
    });

    if (!sprint) {
      throw new NotFoundException('Sprint introuvable.');
    }

    await this.assertWorkspaceMember(sprint.workspaceId, userId);

    const tasks = await this.prisma.task.findMany({
      where: {
        sprintId,
        deletedAt: null,
      },
      select: {
        id: true,
        storyPoints: true,
        status: true,
        completedAt: true,
      },
    });

    const totalPoints = tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);

    const dates: string[] = [];
    const current = new Date(sprint.startDate);
    const end = new Date(sprint.endDate);

    // Travailler en UTC pour éviter tout décalage dû au timezone
    const startUtc = new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()),
    );
    const endUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

    if (startUtc > endUtc) {
      throw new BadRequestException('La date de début doit être antérieure à la date de fin.');
    }

    const tempDate = new Date(startUtc);
    while (tempDate <= endUtc) {
      dates.push(tempDate.toISOString().split('T')[0]);
      tempDate.setUTCDate(tempDate.getUTCDate() + 1);
    }

    const pointsData = dates.map((dateStr, index) => {
      // Date de fin de journée en UTC
      const dayEnd = new Date(dateStr + 'T23:59:59.999Z');

      // Calcul des points complétés jusqu'à la fin de ce jour
      const completedPoints = tasks
        .filter((t) => t.status === 'DONE' && t.completedAt && new Date(t.completedAt) <= dayEnd)
        .reduce((sum, t) => sum + (t.storyPoints || 0), 0);

      // Story points restants
      const remainingReal = Math.max(0, totalPoints - completedPoints);

      // Ligne idéale (burndown théorique)
      let remainingIdeal = totalPoints;
      if (dates.length > 1) {
        remainingIdeal = Math.max(0, totalPoints - (totalPoints / (dates.length - 1)) * index);
      } else {
        remainingIdeal = 0;
      }

      return {
        date: dateStr,
        real: remainingReal,
        ideal: parseFloat(remainingIdeal.toFixed(1)),
      };
    });

    return {
      sprintName: sprint.name,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      totalPoints,
      data: pointsData,
    };
  }
}
