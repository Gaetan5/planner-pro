import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceRole } from '@prisma/client';

@Injectable()
export class ResourcesService {
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

  private async assertWorkspaceRole(workspaceId: string, userId: string, allowedRoles: WorkspaceRole[]) {
    const membership = await this.assertWorkspaceMember(workspaceId, userId);
    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Unauthorized: insufficient workspace permissions');
    }
    return membership;
  }

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
    data: { weeklyCapacityMinutes?: number; skills?: string; costRateCents?: number; billingRateCents?: number },
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
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        OR: [
          { userId: actingUserId },
          { workspace: { memberships: { some: { userId: actingUserId } } } },
        ],
      },
    });
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

  async optimizeWorkspaceResources(workspaceId: string, userId: string) {
    await this.assertWorkspaceRole(workspaceId, userId, ['OWNER', 'ADMIN'] as WorkspaceRole[]);

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
