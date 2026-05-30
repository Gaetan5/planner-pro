import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotesService } from '../notes/notes.service';
import { IntegrationService } from './integration.service';
import { Prisma, TaskPriority, ProjectStatus, DeliverableStatus, DependencyType, DeliveryStatus, WorkspaceRole, TaskStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notesService: NotesService,
    private readonly integrationService: IntegrationService,
  ) {}

  private async ensureDefaultWorkspace(userId: string) {
    const existingMembership = await this.prisma.membership.findFirst({
      where: {
        userId,
        workspace: { deletedAt: null },
      },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    if (existingMembership?.workspace) {
      return existingMembership.workspace;
    }

    return this.prisma.workspace.create({
      data: {
        name: 'Espace principal',
        ownerId: userId,
        memberships: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
    });
  }

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

  private async assertWorkspaceRole(workspaceId: string, userId: string, allowedRoles: WorkspaceRole[]) {
    const membership = await this.assertWorkspaceMember(workspaceId, userId);
    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Unauthorized: insufficient workspace permissions');
    }
    return membership;
  }

  private async getAccessibleUserIds(workspaceId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId },
      select: { userId: true },
    });
    return memberships.map((membership) => membership.userId);
  }

  private parseTaskDates(data: CreateTaskDto | UpdateTaskDto) {
    return {
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    };
  }

  private buildTaskMutationData(data: CreateTaskDto | UpdateTaskDto): Prisma.TaskUpdateInput {
    const dates = this.parseTaskDates(data);
    return {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...('status' in data && data.status !== undefined ? { status: data.status } : {}),
      ...(dates.startDate !== undefined ? { startDate: dates.startDate } : {}),
      ...(dates.dueDate !== undefined ? { dueDate: dates.dueDate } : {}),
      ...(data.estimatedMinutes !== undefined ? { estimatedMinutes: data.estimatedMinutes } : {}),
      ...(data.progress !== undefined ? { progress: data.progress } : {}),
      ...(data.labels !== undefined ? { labels: data.labels } : {}),
    };
  }

  private async replaceTaskAssignees(taskId: string, workspaceId: string | null, assigneeIds?: string[]) {
    if (!assigneeIds) return;

    const allowedUserIds = workspaceId ? await this.getAccessibleUserIds(workspaceId) : [];
    const uniqueAssigneeIds = [...new Set(assigneeIds)].filter((id) => allowedUserIds.includes(id));

    await this.prisma.taskAssignee.deleteMany({ where: { taskId } });

    if (uniqueAssigneeIds.length > 0) {
      await this.prisma.taskAssignee.createMany({
        data: uniqueAssigneeIds.map((userId) => ({ taskId, userId })),
        skipDuplicates: true,
      });
    }
  }

  async getWorkspaces(userId: string) {
    await this.ensureDefaultWorkspace(userId);
    return this.prisma.workspace.findMany({
      where: {
        deletedAt: null,
        memberships: { some: { userId } },
      },
      include: {
        memberships: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        teams: { where: { deletedAt: null } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getWorkspaceMembers(userId: string, workspaceId?: string) {
    const workspace = workspaceId ? { id: workspaceId } : await this.ensureDefaultWorkspace(userId);
    await this.assertWorkspaceMember(workspace.id, userId);

    return this.prisma.membership.findMany({
      where: { workspaceId: workspace.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createProject(
    userId: string,
    name: string,
    description?: string,
    workspaceId?: string,
    status: ProjectStatus = ProjectStatus.PLANNING,
    startDate?: string,
    dueDate?: string,
  ) {
    const workspace = workspaceId ? { id: workspaceId } : await this.ensureDefaultWorkspace(userId);
    await this.assertWorkspaceMember(workspace.id, userId);

    return this.prisma.project.create({
      data: {
        name,
        description,
        userId,
        workspaceId: workspace.id,
        status,
        startDate: startDate ? new Date(startDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
      },
    });
  }

  async getProjects(userId: string) {
    await this.ensureDefaultWorkspace(userId);
    return this.prisma.project.findMany({
      where: {
        deletedAt: null,
        OR: [
          { userId },
          { workspace: { memberships: { some: { userId } } } },
        ],
      },
      include: {
        workspace: true,
        phases: { orderBy: { order: 'asc' } },
        milestones: { orderBy: { dueDate: 'asc' } },
        deliverables: { orderBy: { dueDate: 'asc' } },
        deliveries: { include: { checklist: true }, orderBy: { createdAt: 'desc' } },
        tasks: {
          where: { deletedAt: null },
          include: {
            assignees: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
            dependencies: { include: { dependsOnTask: true } },
            dependents: { include: { task: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getProject(projectId: string, userId: string) {
    return this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        OR: [
          { userId },
          { workspace: { memberships: { some: { userId } } } },
        ],
      },
      include: {
        workspace: true,
        phases: { orderBy: { order: 'asc' } },
        milestones: { orderBy: { dueDate: 'asc' } },
        deliverables: { orderBy: { dueDate: 'asc' } },
        deliveries: { include: { checklist: true }, orderBy: { createdAt: 'desc' } },
        tasks: {
          where: { deletedAt: null },
          include: {
            assignees: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
            dependencies: { include: { dependsOnTask: true } },
            dependents: { include: { task: true } },
          },
        },
      },
    });
  }

  async updateProject(projectId: string, userId: string, data: UpdateProjectDto) {
    const project = await this.getProject(projectId, userId);
    if (!project) {
      throw new Error('Project not found or unauthorized');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.startDate !== undefined ? { startDate: new Date(data.startDate) } : {}),
        ...(data.dueDate !== undefined ? { dueDate: new Date(data.dueDate) } : {}),
      },
    });
  }

  async deleteProject(projectId: string, userId: string) {
    const project = await this.getProject(projectId, userId);
    if (!project) {
      throw new Error('Project not found or unauthorized');
    }

    await this.prisma.task.updateMany({
      where: { projectId },
      data: { deletedAt: new Date() },
    });
    return this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });
  }

  async createTask(
    projectId: string,
    userId: string,
    title: string,
    description?: string,
    priority: TaskPriority = TaskPriority.MEDIUM,
    options: Omit<CreateTaskDto, 'title' | 'description' | 'priority'> = {},
  ) {
    const project = await this.getProject(projectId, userId);
    if (!project) {
      throw new Error('Project not found or unauthorized');
    }

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
      },
      include: {
        assignees: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        dependencies: { include: { dependsOnTask: true } },
        dependents: { include: { task: true } },
      },
    });

    await this.replaceTaskAssignees(task.id, project.workspaceId, options.assigneeIds);
    const finalTask = await this.prisma.task.findUnique({
      where: { id: task.id },
      include: {
        assignees: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        dependencies: { include: { dependsOnTask: true } },
        dependents: { include: { task: true } },
      },
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
    const project = await this.getProject(projectId, userId);
    if (!project) {
      throw new Error('Project not found or unauthorized');
    }

    return this.prisma.task.findMany({
      where: { projectId, deletedAt: null },
      include: {
        assignees: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        dependencies: { include: { dependsOnTask: true } },
        dependents: { include: { task: true } },
      },
    });
  }

  async updateTask(taskId: string, userId: string, data: UpdateTaskDto) {
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
      throw new Error('Task not found or unauthorized');
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: this.buildTaskMutationData(data),
      include: {
        assignees: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        dependencies: { include: { dependsOnTask: true } },
        dependents: { include: { task: true } },
      },
    });

    await this.replaceTaskAssignees(taskId, task.project.workspaceId, data.assigneeIds);

    if ((data.status || data.title) && updatedTask.noteId) {
      await this.notesService.syncTaskStatusToNote(taskId, updatedTask.status);
    }

    const finalTask = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignees: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        dependencies: { include: { dependsOnTask: true } },
        dependents: { include: { task: true } },
      },
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

    return finalTask;
  }

  async deleteTask(taskId: string, userId: string) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [
          { userId },
          { project: { workspace: { memberships: { some: { userId } } } } },
        ],
      },
    });
    if (!task) {
      throw new Error('Task not found or unauthorized');
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data: { deletedAt: new Date() },
    });
  }

  async createMilestone(projectId: string, userId: string, name: string, description?: string, dueDate?: string) {
    const project = await this.getProject(projectId, userId);
    if (!project || !project.workspaceId) {
      throw new BadRequestException('Project or workspace not found');
    }
    await this.assertWorkspaceRole(project.workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    return this.prisma.milestone.create({
      data: {
        projectId,
        name,
        description,
        dueDate: dueDate ? new Date(dueDate) : undefined,
      },
    });
  }

  async completeMilestone(milestoneId: string, userId: string) {
    const milestone = await this.prisma.milestone.findFirst({
      where: {
        id: milestoneId,
        project: { deletedAt: null },
      },
      include: { project: true },
    });
    if (!milestone || !milestone.project || !milestone.project.workspaceId) {
      throw new BadRequestException('Milestone or workspace not found');
    }
    await this.assertWorkspaceRole(milestone.project.workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    return this.prisma.milestone.update({
      where: { id: milestoneId },
      data: { completedAt: new Date() },
    });
  }

  async createDeliverable(
    projectId: string,
    userId: string,
    title: string,
    description?: string,
    status: DeliverableStatus = DeliverableStatus.DRAFT,
    dueDate?: string,
  ) {
    const project = await this.getProject(projectId, userId);
    if (!project || !project.workspaceId) {
      throw new BadRequestException('Project or workspace not found');
    }
    await this.assertWorkspaceRole(project.workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    return this.prisma.deliverable.create({
      data: {
        projectId,
        title,
        description,
        status,
        dueDate: dueDate ? new Date(dueDate) : undefined,
      },
    });
  }

  async updateDeliverableStatus(deliverableId: string, userId: string, status: DeliverableStatus) {
    const deliverable = await this.prisma.deliverable.findFirst({
      where: {
        id: deliverableId,
        project: { deletedAt: null },
      },
      include: { project: true },
    });
    if (!deliverable || !deliverable.project || !deliverable.project.workspaceId) {
      throw new BadRequestException('Deliverable or workspace not found');
    }
    await this.assertWorkspaceRole(deliverable.project.workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    return this.prisma.deliverable.update({
      where: { id: deliverableId },
      data: {
        status,
        acceptedAt: status === DeliverableStatus.ACCEPTED ? new Date() : deliverable.acceptedAt,
      },
    });
  }

  private async hasPath(startTaskId: string, targetTaskId: string, visited: Set<string>): Promise<boolean> {
    if (startTaskId === targetTaskId) return true;
    if (visited.has(startTaskId)) return false;
    visited.add(startTaskId);

    const dependencies = await this.prisma.taskDependency.findMany({
      where: { taskId: startTaskId },
    });

    for (const dep of dependencies) {
      if (await this.hasPath(dep.dependsOnTaskId, targetTaskId, visited)) {
        return true;
      }
    }

    return false;
  }

  async addTaskDependency(taskId: string, userId: string, dependsOnTaskId: string, type: DependencyType = DependencyType.FINISH_TO_START) {
    if (taskId === dependsOnTaskId) {
      throw new BadRequestException('A task cannot depend on itself');
    }

    const [task, dependsOnTask] = await Promise.all([
      this.prisma.task.findFirst({
        where: {
          id: taskId,
          deletedAt: null,
          OR: [
            { userId },
            { project: { workspace: { memberships: { some: { userId } } } } },
          ],
        },
      }),
      this.prisma.task.findFirst({
        where: {
          id: dependsOnTaskId,
          deletedAt: null,
          OR: [
            { userId },
            { project: { workspace: { memberships: { some: { userId } } } } },
          ],
        },
      }),
    ]);

    if (!task || !dependsOnTask || task.projectId !== dependsOnTask.projectId) {
      throw new BadRequestException('Dependency tasks not found, unauthorized, or not in the same project');
    }

    // Vérifier si dependsOnTaskId dépend déjà de taskId (ce qui créerait un cycle)
    const isCyclic = await this.hasPath(dependsOnTaskId, taskId, new Set<string>());
    if (isCyclic) {
      throw new BadRequestException('Creating this dependency would create a cycle (circular dependency detected)');
    }

    return this.prisma.taskDependency.create({
      data: { taskId, dependsOnTaskId, type },
    });
  }

  async removeTaskDependency(taskId: string, userId: string, dependsOnTaskId: string) {
    const dependency = await this.prisma.taskDependency.findFirst({
      where: {
        taskId,
        dependsOnTaskId,
        task: {
          deletedAt: null,
          OR: [
            { userId },
            { project: { workspace: { memberships: { some: { userId } } } } },
          ],
        },
      },
    });
    if (!dependency) {
      throw new Error('Dependency not found or unauthorized');
    }

    return this.prisma.taskDependency.delete({ where: { id: dependency.id } });
  }

  async createDelivery(projectId: string, userId: string, summary?: string, checklist: string[] = []) {
    const project = await this.getProject(projectId, userId);
    if (!project || !project.workspaceId) {
      throw new BadRequestException('Project or workspace not found');
    }
    await this.assertWorkspaceRole(project.workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    return this.prisma.deliveryRecord.create({
      data: {
        projectId,
        summary,
        checklist: {
          create: checklist.map((title) => ({ title })),
        },
      },
      include: { checklist: true },
    });
  }

  async updateDeliveryStatus(deliveryId: string, userId: string, status: DeliveryStatus) {
    const delivery = await this.prisma.deliveryRecord.findFirst({
      where: {
        id: deliveryId,
        project: { deletedAt: null },
      },
      include: { project: true },
    });
    if (!delivery || !delivery.project || !delivery.project.workspaceId) {
      throw new BadRequestException('Delivery or workspace not found');
    }
    await this.assertWorkspaceRole(delivery.project.workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    const now = new Date();
    const updated = await this.prisma.deliveryRecord.update({
      where: { id: deliveryId },
      data: {
        status,
        deliveredAt: status === DeliveryStatus.READY_FOR_ACCEPTANCE ? now : delivery.deliveredAt,
        acceptedAt: status === DeliveryStatus.ACCEPTED ? now : delivery.acceptedAt,
      },
      include: { checklist: true },
    });

    if (status === DeliveryStatus.ACCEPTED) {
      await this.prisma.project.update({
        where: { id: delivery.projectId },
        data: { status: ProjectStatus.DELIVERED },
      });
    }

    return updated;
  }

  async toggleDeliveryChecklistItem(itemId: string, userId: string) {
    const item = await this.prisma.deliveryChecklistItem.findFirst({
      where: {
        id: itemId,
        delivery: {
          project: { deletedAt: null },
        },
      },
      include: { delivery: { include: { project: true } } },
    });
    if (!item || !item.delivery || !item.delivery.project || !item.delivery.project.workspaceId) {
      throw new BadRequestException('Checklist item or workspace not found');
    }
    await this.assertWorkspaceRole(item.delivery.project.workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER]);

    return this.prisma.deliveryChecklistItem.update({
      where: { id: itemId },
      data: { checked: !item.checked },
    });
  }

  async getDeliveryReport(projectId: string, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        OR: [
          { userId },
          { workspace: { memberships: { some: { userId } } } },
        ],
      },
      include: {
        tasks: { where: { deletedAt: null }, include: { timeLogs: true } },
        milestones: true,
        deliverables: true,
        deliveries: { include: { checklist: true } },
      },
    });
    if (!project) {
      throw new Error('Project not found or unauthorized');
    }

    const totalTasks = project.tasks.length;
    const completedTasks = project.tasks.filter((task) => task.status === 'DONE').length;
    const totalTrackedSeconds = project.tasks.reduce(
      (total, task) => total + task.timeLogs.reduce((sum, log) => sum + (log.duration ?? 0), 0),
      0,
    );
    const acceptedDeliverables = project.deliverables.filter((item) => item.status === 'ACCEPTED' || item.status === 'DELIVERED').length;
    const completedMilestones = project.milestones.filter((item) => item.completedAt).length;

    return {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        startDate: project.startDate,
        dueDate: project.dueDate,
      },
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      },
      milestones: {
        total: project.milestones.length,
        completed: completedMilestones,
      },
      deliverables: {
        total: project.deliverables.length,
        accepted: acceptedDeliverables,
      },
      time: {
        trackedSeconds: totalTrackedSeconds,
        trackedHours: Math.round((totalTrackedSeconds / 3600) * 100) / 100,
      },
      deliveries: project.deliveries,
      readyForClosure: totalTasks === completedTasks && project.deliverables.length === acceptedDeliverables,
    };
  }

  private async ensureResourceProfiles(workspaceId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId },
      select: { userId: true },
    });

    for (const membership of memberships) {
      await this.prisma.resourceProfile.upsert({
        where: { workspaceId_userId: { workspaceId, userId: membership.userId } },
        update: {},
        create: { workspaceId, userId: membership.userId },
      });
    }
  }

  async getResourceCapacityReport(userId: string, workspaceId?: string) {
    const workspace = workspaceId ? { id: workspaceId } : await this.ensureDefaultWorkspace(userId);
    await this.assertWorkspaceMember(workspace.id, userId);
    await this.ensureResourceProfiles(workspace.id);

    const windowStart = new Date();
    const windowEnd = new Date(windowStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [memberships, profiles, openTasks, timeBlocks, allocations] = await Promise.all([
      this.prisma.membership.findMany({
        where: { workspaceId: workspace.id },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.resourceProfile.findMany({ where: { workspaceId: workspace.id } }),
      this.prisma.task.findMany({
        where: {
          deletedAt: null,
          status: { not: 'DONE' },
          project: { workspaceId: workspace.id, deletedAt: null },
        },
        include: { assignees: true },
      }),
      this.prisma.timeBlock.findMany({
        where: {
          startTime: { gte: windowStart, lt: windowEnd },
          task: { project: { workspaceId: workspace.id, deletedAt: null }, deletedAt: null },
        },
        include: { task: { include: { assignees: true } } },
      }),
      this.prisma.resourceAllocation.findMany({
        where: {
          project: { workspaceId: workspace.id, deletedAt: null },
          OR: [
            { endDate: null },
            { endDate: { gte: windowStart } },
          ],
        },
        include: { project: true },
      }),
    ]);

    return memberships.map((membership) => {
      const profile = profiles.find((item) => item.userId === membership.userId);
      const weeklyCapacityMinutes = profile?.weeklyCapacityMinutes ?? 2400;
      const assignedTaskIds = new Set(
        openTasks
          .filter((task) => task.userId === membership.userId || task.assignees.some((assignee) => assignee.userId === membership.userId))
          .map((task) => task.id),
      );
      const estimatedOpenMinutes = openTasks
        .filter((task) => assignedTaskIds.has(task.id))
        .reduce((total, task) => total + (task.estimatedMinutes ?? 0), 0);
      const plannedMinutes = timeBlocks
        .filter((block) => block.task.userId === membership.userId || block.task.assignees.some((assignee) => assignee.userId === membership.userId))
        .reduce((total, block) => total + Math.max(0, Math.round((block.endTime.getTime() - block.startTime.getTime()) / 60000)), 0);
      const allocationPercent = allocations
        .filter((allocation) => allocation.userId === membership.userId)
        .reduce((total, allocation) => total + allocation.allocationPercent, 0);
      const loadPercent = weeklyCapacityMinutes > 0 ? Math.round((plannedMinutes / weeklyCapacityMinutes) * 100) : 0;

      return {
        user: membership.user,
        role: membership.role,
        profile,
        weeklyCapacityMinutes,
        plannedMinutes,
        estimatedOpenMinutes,
        allocationPercent,
        loadPercent,
        overloaded: plannedMinutes > weeklyCapacityMinutes || allocationPercent > 100,
        conflicts: [
          ...(plannedMinutes > weeklyCapacityMinutes ? ['CAPACITY_EXCEEDED'] : []),
          ...(allocationPercent > 100 ? ['ALLOCATION_EXCEEDED'] : []),
        ],
      };
    });
  }

  async updateResourceProfile(
    actingUserId: string,
    memberUserId: string,
    data: { weeklyCapacityMinutes?: number; skills?: string; costRateCents?: number },
    workspaceId?: string,
  ) {
    const workspace = workspaceId ? { id: workspaceId } : await this.ensureDefaultWorkspace(actingUserId);
    await this.assertWorkspaceRole(workspace.id, actingUserId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    await this.assertWorkspaceMember(workspace.id, memberUserId);

    return this.prisma.resourceProfile.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: memberUserId } },
      update: data,
      create: { workspaceId: workspace.id, userId: memberUserId, ...data },
    });
  }

  async createResourceAllocation(
    projectId: string,
    actingUserId: string,
    userId: string,
    allocationPercent: number,
    roleLabel?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const project = await this.getProject(projectId, actingUserId);
    if (!project || !project.workspaceId) {
      throw new BadRequestException('Project or workspace not found');
    }
    await this.assertWorkspaceRole(project.workspaceId, actingUserId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    await this.assertWorkspaceMember(project.workspaceId, userId);

    return this.prisma.resourceAllocation.create({
      data: {
        projectId,
        userId,
        allocationPercent,
        roleLabel,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      },
    });
  }

  async createTimeBlock(taskId: string, userId: string, startTime: Date, endTime: Date) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [
          { userId },
          { project: { workspace: { memberships: { some: { userId } } } } },
        ],
      },
    });
    if (!task) {
      throw new Error('Task not found or unauthorized');
    }

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
          OR: [
            { userId },
            { project: { workspace: { memberships: { some: { userId } } } } },
          ],
        },
        ...(start || end ? {
          startTime: {
            ...(start ? { gte: start } : {}),
            ...(end ? { lt: end } : {}),
          }
        } : {})
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
    const timeBlock = await this.prisma.timeBlock.findFirst({
      where: {
        id: timeBlockId,
        task: {
          deletedAt: null,
          OR: [
            { userId },
            { project: { workspace: { memberships: { some: { userId } } } } },
          ],
        },
      },
    });
    if (!timeBlock) {
      throw new Error('Time block not found or unauthorized');
    }

    return this.prisma.timeBlock.update({
      where: { id: timeBlockId },
      data: {
        startTime,
        endTime,
      },
    });
  }

  async deleteTimeBlock(timeBlockId: string, userId: string) {
    const timeBlock = await this.prisma.timeBlock.findFirst({
      where: {
        id: timeBlockId,
        task: {
          deletedAt: null,
          OR: [
            { userId },
            { project: { workspace: { memberships: { some: { userId } } } } },
          ],
        },
      },
    });
    if (!timeBlock) {
      throw new Error('Time block not found or unauthorized');
    }

    return this.prisma.timeBlock.delete({
      where: { id: timeBlockId },
    });
  }

  private verifyGitHubSignature(payload: any, signature?: string): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      // Si aucun secret n'est configuré, validation passive par défaut
      return true;
    }
    if (!signature) {
      return false;
    }
    try {
      const hmac = crypto.createHmac('sha256', secret);
      const bodyStr = JSON.stringify(payload);
      const digest = 'sha256=' + hmac.update(bodyStr).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
    } catch (e) {
      return false;
    }
  }

  private extractTaskIdsFromText(text: string): string[] {
    if (!text) return [];
    const regex = /(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\s+#([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/gi;
    const taskIds: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      taskIds.push(match[1]);
    }
    return taskIds;
  }

  private async closeTaskFromWebhook(taskId: string): Promise<boolean> {
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

  async handleGitHubWebhook(payload: any, signature?: string): Promise<string[]> {
    if (!this.verifyGitHubSignature(payload, signature)) {
      throw new ForbiddenException('Signature webhook GitHub invalide');
    }

    const taskIdsToClose = new Set<string>();

    if (payload.action === 'closed' && payload.pull_request) {
      const pr = payload.pull_request;
      if (pr.merged === true) {
        const textToSearch = `${pr.title || ''} ${pr.body || ''}`;
        const ids = this.extractTaskIdsFromText(textToSearch);
        ids.forEach(id => taskIdsToClose.add(id));
      }
    }

    if (payload.commits && Array.isArray(payload.commits)) {
      for (const commit of payload.commits) {
        if (commit.message) {
          const ids = this.extractTaskIdsFromText(commit.message);
          ids.forEach(id => taskIdsToClose.add(id));
        }
      }
    }

    const closedIds: string[] = [];
    for (const taskId of taskIdsToClose) {
      const success = await this.closeTaskFromWebhook(taskId);
      if (success) {
        closedIds.push(taskId);
      }
    }

    return closedIds;
  }

  async optimizeWorkspaceResources(workspaceId: string, userId: string) {
    await this.assertWorkspaceRole(workspaceId, userId, ['OWNER', 'ADMIN']);

    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: true },
    });

    await this.ensureResourceProfiles(workspaceId);
    const profiles = await this.prisma.resourceProfile.findMany({
      where: { workspaceId },
    });

    const openTasks = await this.prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { not: 'DONE' },
        project: { workspaceId, deletedAt: null },
      },
      include: { assignees: true },
    });

    if (openTasks.length === 0 || memberships.length === 0) {
      return { success: true, message: 'Aucune tâche à optimiser.', reallocatedCount: 0 };
    }

    const developerLoads = new Map<string, number>();
    memberships.forEach((m) => {
      developerLoads.set(m.userId, 0);
    });

    const developerCapacities = new Map<string, number>();
    memberships.forEach((m) => {
      const profile = profiles.find((p) => p.userId === m.userId);
      developerCapacities.set(m.userId, profile?.weeklyCapacityMinutes ?? 2400);
    });

    const priorityWeight = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    const sortedTasks = [...openTasks].sort((a, b) => {
      const pA = priorityWeight[a.priority] || 2;
      const pB = priorityWeight[b.priority] || 2;
      if (pB !== pA) {
        return pB - pA;
      }
      const tA = a.estimatedMinutes ?? 120;
      const tB = b.estimatedMinutes ?? 120;
      return tB - tA;
    });

    const reallocations: { taskId: string; userId: string }[] = [];

    for (const task of sortedTasks) {
      const taskMinutes = task.estimatedMinutes ?? 120;

      let bestUserId = memberships[0].userId;
      let lowestLoadRatio = Infinity;

      for (const m of memberships) {
        const currentLoad = developerLoads.get(m.userId) || 0;
        const capacity = developerCapacities.get(m.userId) || 2400;
        const ratio = capacity > 0 ? currentLoad / capacity : Infinity;

        if (ratio < lowestLoadRatio) {
          lowestLoadRatio = ratio;
          bestUserId = m.userId;
        }
      }

      const isAlreadyAssignedOnlyToBest =
        task.assignees.length === 1 && task.assignees[0].userId === bestUserId;

      if (!isAlreadyAssignedOnlyToBest) {
        reallocations.push({ taskId: task.id, userId: bestUserId });
      }

      const currentLoad = developerLoads.get(bestUserId) || 0;
      developerLoads.set(bestUserId, currentLoad + taskMinutes);
    }

    for (const realloc of reallocations) {
      await this.prisma.taskAssignee.deleteMany({
        where: { taskId: realloc.taskId },
      });
      await this.prisma.taskAssignee.create({
        data: {
          taskId: realloc.taskId,
          userId: realloc.userId,
        },
      });
    }

    return {
      success: true,
      message: `Optimisation réussie. ${reallocations.length} tâches réallouées.`,
      reallocatedCount: reallocations.length,
      reallocatedTaskIds: reallocations.map((r) => r.taskId),
    };
  }
}
