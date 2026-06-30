import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceRole, DeliverableStatus, DeliveryStatus, ProjectStatus } from '@prisma/client';

@Injectable()
export class MilestonesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertWorkspaceRole(
    workspaceId: string,
    userId: string,
    allowedRoles: WorkspaceRole[],
  ) {
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
    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Unauthorized: insufficient workspace permissions');
    }
    return membership;
  }

  private async assertProjectAccess(projectId: string, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        OR: [{ userId }, { workspace: { memberships: { some: { userId } } } }],
      },
    });
    if (!project) {
      throw new BadRequestException('Project not found or unauthorized');
    }
    return project;
  }

  // ─── Milestones ───────────────────────────────────────────────────

  async createMilestone(
    projectId: string,
    userId: string,
    name: string,
    description?: string,
    dueDate?: string,
  ) {
    const project = await this.assertProjectAccess(projectId, userId);
    if (!project.workspaceId) {
      throw new BadRequestException('Workspace not found for this project');
    }
    await this.assertWorkspaceRole(project.workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

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
    await this.assertWorkspaceRole(milestone.project.workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    return this.prisma.milestone.update({
      where: { id: milestoneId },
      data: { completedAt: new Date() },
    });
  }

  // ─── Deliverables ─────────────────────────────────────────────────

  async createDeliverable(
    projectId: string,
    userId: string,
    title: string,
    description?: string,
    status: DeliverableStatus = DeliverableStatus.DRAFT,
    dueDate?: string,
  ) {
    const project = await this.assertProjectAccess(projectId, userId);
    if (!project.workspaceId) {
      throw new BadRequestException('Workspace not found for this project');
    }
    await this.assertWorkspaceRole(project.workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

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
    await this.assertWorkspaceRole(deliverable.project.workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    return this.prisma.deliverable.update({
      where: { id: deliverableId },
      data: {
        status,
        acceptedAt: status === DeliverableStatus.ACCEPTED ? new Date() : deliverable.acceptedAt,
      },
    });
  }

  // ─── Delivery Records ─────────────────────────────────────────────

  async createDelivery(
    projectId: string,
    userId: string,
    summary?: string,
    checklist: string[] = [],
  ) {
    const project = await this.assertProjectAccess(projectId, userId);
    if (!project.workspaceId) {
      throw new BadRequestException('Workspace not found for this project');
    }
    await this.assertWorkspaceRole(project.workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

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
    await this.assertWorkspaceRole(delivery.project.workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

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
    await this.assertWorkspaceRole(item.delivery.project.workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
      WorkspaceRole.MEMBER,
    ]);

    return this.prisma.deliveryChecklistItem.update({
      where: { id: itemId },
      data: { checked: !item.checked },
    });
  }

  // ─── Delivery Report ──────────────────────────────────────────────

  async getDeliveryReport(projectId: string, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        OR: [{ userId }, { workspace: { memberships: { some: { userId } } } }],
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
    const acceptedDeliverables = project.deliverables.filter(
      (item) => item.status === 'ACCEPTED' || item.status === 'DELIVERED',
    ).length;
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
      readyForClosure:
        totalTasks === completedTasks && project.deliverables.length === acceptedDeliverables,
    };
  }
}
