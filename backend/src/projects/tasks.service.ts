import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotesService } from '../notes/notes.service';
import { IntegrationService } from './integration.service';
import { Prisma, TaskPriority, TaskStatus, WorkspaceRole } from '@prisma/client';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { NotificationsService } from '../notifications/notifications.service';

const TASK_INCLUDE = {
  assignees: {
    include: { user: { select: { id: true, name: true, email: true } } },
  },
  dependencies: { include: { dependsOnTask: true } },
  dependents: { include: { task: true } },
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notesService: NotesService,
    private readonly integrationService: IntegrationService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Helpers partagés ───────────────────────────────────────────────

  parseTaskDates(data: CreateTaskDto | UpdateTaskDto) {
    return {
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    };
  }

  buildTaskMutationData(data: CreateTaskDto | UpdateTaskDto): Prisma.TaskUpdateInput {
    const dates = this.parseTaskDates(data);
    return {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...('status' in data && data.status !== undefined ? {
        status: data.status,
        completedAt: data.status === 'DONE' ? new Date() : null,
      } : {}),
      ...(dates.startDate !== undefined ? { startDate: dates.startDate } : {}),
      ...(dates.dueDate !== undefined ? { dueDate: dates.dueDate } : {}),
      ...(data.estimatedMinutes !== undefined ? { estimatedMinutes: data.estimatedMinutes } : {}),
      ...(data.progress !== undefined ? { progress: data.progress } : {}),
      ...(data.labels !== undefined ? { labels: data.labels } : {}),
      ...(data.storyPoints !== undefined ? { storyPoints: data.storyPoints } : {}),
      ...(data.sprintId !== undefined ? { sprintId: data.sprintId } : {}),
    };
  }

  private async getAccessibleUserIds(workspaceId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId },
      select: { userId: true },
    });
    return memberships.map((membership) => membership.userId);
  }

  async replaceTaskAssignees(taskId: string, workspaceId: string | null, assigneeIds?: string[], actingUserId?: string) {
    if (!assigneeIds) return;

    const allowedUserIds = workspaceId ? await this.getAccessibleUserIds(workspaceId) : [];
    const uniqueAssigneeIds = [...new Set(assigneeIds)].filter((id) => allowedUserIds.includes(id));

    // Récupérer les assignés existants pour savoir qui est nouveau
    const existingAssignees = await this.prisma.taskAssignee.findMany({
      where: { taskId },
      select: { userId: true },
    });
    const existingUserIds = existingAssignees.map(a => a.userId);

    await this.prisma.taskAssignee.deleteMany({ where: { taskId } });

    if (uniqueAssigneeIds.length > 0) {
      await this.prisma.taskAssignee.createMany({
        data: uniqueAssigneeIds.map((userId) => ({ taskId, userId })),
        skipDuplicates: true,
      });
    }

    // Récupérer les infos de la tâche pour formater la notification
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { title: true, projectId: true },
    });

    if (task && actingUserId) {
      // Les utilisateurs qui sont dans uniqueAssigneeIds mais pas dans existingUserIds sont nouvellement assignés
      const newAssignees = uniqueAssigneeIds.filter(id => !existingUserIds.includes(id));

      if (newAssignees.length > 0) {
        // Récupérer le nom de la personne qui fait l'assignation
        const actor = await this.prisma.user.findUnique({
          where: { id: actingUserId },
          select: { name: true, email: true },
        });
        const actorName = actor ? (actor.name || actor.email) : 'Un utilisateur';

        for (const userId of newAssignees) {
          if (userId !== actingUserId) {
            await this.notificationsService.createNotification({
              userId,
              senderId: actingUserId,
              type: 'ASSIGNMENT',
              title: 'Nouvelle tâche assignée',
              content: `${actorName} vous a assigné à la tâche "${task.title}".`,
              taskId,
              projectId: task.projectId,
            });
          }
        }
      }
    }
  }

  private async assertTaskAccess(taskId: string, userId: string) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [
          { userId },
          { project: { workspace: { memberships: { some: { userId } } } } },
        ],
      },
      include: { project: true },
    });
    if (!task) {
      throw new BadRequestException('Task not found or unauthorized');
    }
    return task;
  }

  private async assertProjectAccess(projectId: string, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        OR: [
          { userId },
          { workspace: { memberships: { some: { userId } } } },
        ],
      },
    });
    if (!project) {
      throw new BadRequestException('Project not found or unauthorized');
    }
    return project;
  }

  // ─── CRUD Tâches ───────────────────────────────────────────────────

  async createTask(
    projectId: string,
    userId: string,
    title: string,
    description?: string,
    priority: TaskPriority = TaskPriority.MEDIUM,
    options: Omit<CreateTaskDto, 'title' | 'description' | 'priority'> = {},
  ) {
    const project = await this.assertProjectAccess(projectId, userId);

    const dates = this.parseTaskDates(options);
    const task = await this.prisma.task.create({
      data: {
        title,
        description,
        priority,
        startDate: dates.startDate,
        dueDate: dates.dueDate,
        estimatedMinutes: options.estimatedMinutes,
        progress: options.progress ?? 0,
        labels: options.labels,
        projectId,
        userId,
        storyPoints: options.storyPoints,
        sprintId: options.sprintId,
      },
      include: TASK_INCLUDE,
    });

    await this.replaceTaskAssignees(task.id, project.workspaceId, options.assigneeIds, userId);
    const finalTask = await this.prisma.task.findUnique({
      where: { id: task.id },
      include: TASK_INCLUDE,
    });

    if (finalTask) {
      this.integrationService.sendNotification(
        project.workspaceId,
        'Nouvelle Tâche',
        `La tâche "${finalTask.title}" a été créée dans le projet "${project.name}". Priorité : ${finalTask.priority}.`,
      );
    }

    return finalTask;
  }

  async getTasks(projectId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId);

    return this.prisma.task.findMany({
      where: { projectId, deletedAt: null },
      include: TASK_INCLUDE,
    });
  }

  async updateTask(taskId: string, userId: string, data: UpdateTaskDto) {
    const task = await this.assertTaskAccess(taskId, userId);

    const impactedTaskIds: string[] = [];

    // Exécuter l'update et l'auto-scheduling dans une transaction interactive Prisma
    const updatedTask = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: taskId },
        data: this.buildTaskMutationData(data),
        include: TASK_INCLUDE,
      });

      // Lancer la propagation (effet domino) si le dueDate a changé
      const oldDue = task.dueDate ? new Date(task.dueDate) : null;
      const newDue = data.dueDate ? new Date(data.dueDate) : null;

      if (newDue && (!oldDue || oldDue.getTime() !== newDue.getTime())) {
        const visited = new Set<string>([taskId]);
        await this.propagateScheduleUpdates(taskId, newDue, visited, tx, impactedTaskIds);
      }

      return updated;
    });

    await this.replaceTaskAssignees(taskId, task.project.workspaceId, data.assigneeIds, userId);

    if ((data.status || data.title) && updatedTask.noteId) {
      await this.notesService.syncTaskStatusToNote(taskId, updatedTask.status);
    }

    const finalTask = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: TASK_INCLUDE,
    });

    if (finalTask) {
      if (data.status === 'DONE' && task.status !== 'DONE') {
        this.integrationService.sendNotification(
          task.project.workspaceId,
          'Tâche Terminée',
          `La tâche "${finalTask.title}" du projet "${task.project.name}" a été marquée comme terminée.`,
        );
      }
    }

    return {
      ...finalTask,
      impactedTaskIds,
    };
  }

  async deleteTask(taskId: string, userId: string) {
    await this.assertTaskAccess(taskId, userId);

    return this.prisma.task.update({
      where: { id: taskId },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Propagation Domino (Auto-Scheduling) ─────────────────────────

  /**
   * Propage récursivement le décalage de planification aux tâches dépendantes (effet domino).
   */
  private async propagateScheduleUpdates(
    taskId: string,
    newDueDate: Date,
    visited: Set<string>,
    tx: any,
    impactedIds: string[],
  ): Promise<void> {
    const dependencies = await tx.taskDependency.findMany({
      where: {
        dependsOnTaskId: taskId,
        type: 'FINISH_TO_START',
      },
      include: {
        task: true,
      },
    });

    for (const dep of dependencies) {
      const childTask = dep.task;
      if (!childTask || childTask.deletedAt || visited.has(childTask.id)) continue;

      const childStart = childTask.startDate ? new Date(childTask.startDate) : null;
      const childDue = childTask.dueDate ? new Date(childTask.dueDate) : null;

      if (childStart && childDue) {
        if (newDueDate > childStart) {
          const duration = childDue.getTime() - childStart.getTime();
          const newStart = new Date(newDueDate.getTime());
          const newDue = new Date(newStart.getTime() + duration);

          await tx.task.update({
            where: { id: childTask.id },
            data: {
              startDate: newStart,
              dueDate: newDue,
            },
          });

          impactedIds.push(childTask.id);
          visited.add(childTask.id);

          await this.propagateScheduleUpdates(childTask.id, newDue, visited, tx, impactedIds);
        }
      }
    }
  }

  // ─── GitHub Webhooks ──────────────────────────────────────────────

  async closeTaskFromWebhook(taskId: string): Promise<boolean> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
    });
    if (!task) {
      return false;
    }
    if (task.status === TaskStatus.DONE) {
      return false;
    }
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.DONE, progress: 100 },
    });
    if (task.noteId) {
      await this.notesService.syncTaskStatusToNote(taskId, TaskStatus.DONE);
    }
    return true;
  }
}
