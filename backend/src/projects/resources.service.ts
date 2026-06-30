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

  private async assertWorkspaceRole(
    workspaceId: string,
    userId: string,
    allowedRoles: WorkspaceRole[],
  ) {
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

    const [memberships, profiles, openTasks, timeBlocks, allocations, leaves] = await Promise.all([
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
          OR: [{ endDate: null }, { endDate: { gte: windowStart } }],
        },
        include: { project: true },
      }),
      this.prisma.resourceLeave.findMany({
        where: {
          startDate: { lt: windowEnd },
          endDate: { gte: windowStart },
        },
      }),
    ]);

    return memberships.map((membership) => {
      const profile = profiles.find((item) => item.userId === membership.userId);
      const baseWeeklyCapacity = profile?.weeklyCapacityMinutes ?? 2400;
      const weeklyCapacityMinutes = this.getAdjustedCapacity(
        baseWeeklyCapacity,
        membership.userId,
        windowStart,
        windowEnd,
        leaves,
      );
      const assignedTaskIds = new Set(
        openTasks
          .filter(
            (task) =>
              task.userId === membership.userId ||
              task.assignees.some((assignee) => assignee.userId === membership.userId),
          )
          .map((task) => task.id),
      );
      const estimatedOpenMinutes = openTasks
        .filter((task) => assignedTaskIds.has(task.id))
        .reduce((total, task) => total + (task.estimatedMinutes ?? 0), 0);
      const plannedMinutes = timeBlocks
        .filter(
          (block) =>
            block.task.userId === membership.userId ||
            block.task.assignees.some((assignee) => assignee.userId === membership.userId),
        )
        .reduce(
          (total, block) =>
            total +
            Math.max(0, Math.round((block.endTime.getTime() - block.startTime.getTime()) / 60000)),
          0,
        );
      const allocationPercent = allocations
        .filter((allocation) => allocation.userId === membership.userId)
        .reduce((total, allocation) => total + allocation.allocationPercent, 0);
      const loadPercent =
        weeklyCapacityMinutes > 0 ? Math.round((plannedMinutes / weeklyCapacityMinutes) * 100) : 0;

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
    data: {
      weeklyCapacityMinutes?: number;
      skills?: string;
      costRateCents?: number;
      billingRateCents?: number;
    },
    workspaceId?: string,
  ) {
    const workspace = workspaceId
      ? { id: workspaceId }
      : await this.ensureDefaultWorkspace(actingUserId);
    await this.assertWorkspaceRole(workspace.id, actingUserId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);
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
    await this.assertWorkspaceRole(project.workspaceId, actingUserId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);
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

    const windowStart = new Date();
    const windowEnd = new Date(windowStart.getTime() + 30 * 24 * 60 * 60 * 1000);
    const leaves = await this.prisma.resourceLeave.findMany({
      where: {
        startDate: { lt: windowEnd },
        endDate: { gte: windowStart },
      },
    });

    const developerCapacities = new Map<string, number>();
    memberships.forEach((m) => {
      const profile = profiles.find((p) => p.userId === m.userId);
      const baseCapacity = profile?.weeklyCapacityMinutes ?? 2400;
      const adjustedCapacity = this.getAdjustedCapacity(
        baseCapacity,
        m.userId,
        windowStart,
        windowEnd,
        leaves,
      );
      developerCapacities.set(m.userId, adjustedCapacity || 1); // 1 pour éviter division par 0
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

  // --- CRUD ResourceLeave ---

  async createResourceLeave(
    actingUserId: string,
    userId: string,
    startDate: string,
    endDate: string,
    reason?: string,
  ) {
    // Seul le propriétaire ou un admin, ou l'utilisateur lui-même peut ajouter des congés.
    // Pour simplifier, permettons à l'utilisateur de gérer ses propres congés, ou s'ils partagent un workspace et que l'actingUser y est admin/owner.
    if (actingUserId !== userId) {
      // Vérifier si l'actingUser est OWNER ou ADMIN dans au moins un workspace en commun avec l'utilisateur cible.
      const commonWorkspaces = await this.prisma.membership.findMany({
        where: {
          userId: actingUserId,
          role: { in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN] },
          workspace: {
            memberships: {
              some: { userId },
            },
          },
        },
      });
      if (commonWorkspaces.length === 0) {
        throw new ForbiddenException('Unauthorized to manage leaves for this user');
      }
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      throw new BadRequestException('End date must be after start date');
    }

    return this.prisma.resourceLeave.create({
      data: {
        userId,
        startDate: start,
        endDate: end,
        reason,
      },
    });
  }

  async getResourceLeaves(actingUserId: string, userId: string) {
    if (actingUserId !== userId) {
      const commonWorkspaces = await this.prisma.membership.findMany({
        where: {
          userId: actingUserId,
          workspace: {
            memberships: {
              some: { userId },
            },
          },
        },
      });
      if (commonWorkspaces.length === 0) {
        throw new ForbiddenException('Unauthorized to view leaves for this user');
      }
    }

    return this.prisma.resourceLeave.findMany({
      where: { userId },
      orderBy: { startDate: 'asc' },
    });
  }

  async deleteResourceLeave(actingUserId: string, leaveId: string) {
    const leave = await this.prisma.resourceLeave.findUnique({
      where: { id: leaveId },
    });
    if (!leave) {
      throw new BadRequestException('Leave not found');
    }

    if (actingUserId !== leave.userId) {
      const commonWorkspaces = await this.prisma.membership.findMany({
        where: {
          userId: actingUserId,
          role: { in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN] },
          workspace: {
            memberships: {
              some: { userId: leave.userId },
            },
          },
        },
      });
      if (commonWorkspaces.length === 0) {
        throw new ForbiddenException('Unauthorized to delete leaves for this user');
      }
    }

    return this.prisma.resourceLeave.delete({
      where: { id: leaveId },
    });
  }

  private getAdjustedCapacity(
    weeklyCapacityMinutes: number,
    userId: string,
    windowStart: Date,
    windowEnd: Date,
    leaves: any[],
  ): number {
    let activeDays = 0;
    let workdayCount = 0;

    const start = new Date(windowStart);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(windowEnd);
    end.setUTCHours(0, 0, 0, 0);

    const oneDayMs = 24 * 60 * 60 * 1000;
    for (let time = start.getTime(); time < end.getTime(); time += oneDayMs) {
      const d = new Date(time);
      d.setUTCHours(12, 0, 0, 0);

      const dayOfWeek = d.getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }
      workdayCount++;

      if (isPublicHoliday(d)) {
        continue;
      }

      const hasLeave = leaves.some((leave) => {
        if (leave.userId !== userId) return false;
        const lStart = new Date(leave.startDate);
        lStart.setUTCHours(0, 0, 0, 0);
        const lEnd = new Date(leave.endDate);
        lEnd.setUTCHours(23, 59, 59, 999);
        return d >= lStart && d <= lEnd;
      });

      if (hasLeave) {
        continue;
      }

      activeDays++;
    }
    if (workdayCount === 0) return 0;
    const dailyCapacity = weeklyCapacityMinutes / 5;
    return Math.round(dailyCapacity * activeDays);
  }
}

function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31);
  const day = ((h + L - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isPublicHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  // Fêtes fixes
  if (month === 0 && day === 1) return true; // Jour de l'an
  if (month === 4 && day === 1) return true; // 1er Mai
  if (month === 4 && day === 8) return true; // 8 Mai
  if (month === 6 && day === 14) return true; // 14 Juillet
  if (month === 7 && day === 15) return true; // 15 Août
  if (month === 10 && day === 1) return true; // 1er Novembre
  if (month === 10 && day === 11) return true; // 11 Novembre
  if (month === 11 && day === 25) return true; // 25 Décembre

  const easter = getEasterDate(year);

  const easterMonday = new Date(easter.getTime() + 1 * 24 * 60 * 60 * 1000);
  if (month === easterMonday.getUTCMonth() && day === easterMonday.getUTCDate()) return true;

  const ascension = new Date(easter.getTime() + 39 * 24 * 60 * 60 * 1000);
  if (month === ascension.getUTCMonth() && day === ascension.getUTCDate()) return true;

  const pentecostMonday = new Date(easter.getTime() + 50 * 24 * 60 * 60 * 1000);
  if (month === pentecostMonday.getUTCMonth() && day === pentecostMonday.getUTCDate()) return true;

  return false;
}
