import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceRole, DeliverableStatus, DeliveryStatus, ProjectStatus } from '@prisma/client';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';

@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firestoreSync: FirestoreSyncService,
  ) {}

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

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.milestone.create({
        data: {
          projectId,
          name,
          description,
          dueDate: dueDate ? new Date(dueDate) : undefined,
        },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'milestone',
        entityId: created.id,
        workspaceId: project.workspaceId!,
        operation: 'upsert',
        payload: this.milestoneSyncPayload(created),
      });
      return created;
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

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.milestone.update({
        where: { id: milestoneId },
        data: { completedAt: new Date() },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'milestone',
        entityId: updated.id,
        workspaceId: milestone.project.workspaceId!,
        operation: 'upsert',
        payload: this.milestoneSyncPayload(updated),
      });
      return updated;
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

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.deliverable.create({
        data: {
          projectId,
          title,
          description,
          status,
          dueDate: dueDate ? new Date(dueDate) : undefined,
        },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'deliverable',
        entityId: created.id,
        workspaceId: project.workspaceId!,
        operation: 'upsert',
        payload: this.deliverableSyncPayload(created),
      });
      return created;
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

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deliverable.update({
        where: { id: deliverableId },
        data: {
          status,
          acceptedAt: status === DeliverableStatus.ACCEPTED ? new Date() : deliverable.acceptedAt,
        },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'deliverable',
        entityId: updated.id,
        workspaceId: deliverable.project.workspaceId!,
        operation: 'upsert',
        payload: this.deliverableSyncPayload(updated),
      });
      return updated;
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

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.deliveryRecord.create({
        data: {
          projectId,
          summary,
          checklist: {
            create: checklist.map((title) => ({ title })),
          },
        },
        include: { checklist: true },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'deliveryRecord',
        entityId: created.id,
        workspaceId: project.workspaceId!,
        operation: 'upsert',
        payload: this.deliveryRecordSyncPayload(created),
      });
      for (const item of created.checklist) {
        await this.firestoreSync.enqueue(tx, {
          entityType: 'deliveryChecklistItem',
          entityId: item.id,
          workspaceId: project.workspaceId!,
          operation: 'upsert',
          payload: this.deliveryChecklistItemSyncPayload(item, projectId),
        });
      }
      return created;
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
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deliveryRecord.update({
        where: { id: deliveryId },
        data: {
          status,
          deliveredAt: status === DeliveryStatus.READY_FOR_ACCEPTANCE ? now : delivery.deliveredAt,
          acceptedAt: status === DeliveryStatus.ACCEPTED ? now : delivery.acceptedAt,
        },
        include: { checklist: true },
      });

      if (status === DeliveryStatus.ACCEPTED) {
        await tx.project.update({
          where: { id: delivery.projectId },
          data: { status: ProjectStatus.DELIVERED },
        });
      }

      await this.firestoreSync.enqueue(tx, {
        entityType: 'deliveryRecord',
        entityId: updated.id,
        workspaceId: delivery.project.workspaceId!,
        operation: 'upsert',
        payload: this.deliveryRecordSyncPayload(updated),
      });

      return updated;
    });
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

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deliveryChecklistItem.update({
        where: { id: itemId },
        data: { checked: !item.checked },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'deliveryChecklistItem',
        entityId: updated.id,
        workspaceId: item.delivery.project.workspaceId!,
        operation: 'upsert',
        payload: this.deliveryChecklistItemSyncPayload(updated, item.delivery.projectId),
      });
      return updated;
    });
  }

  private milestoneSyncPayload(milestone: {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    dueDate?: Date | string | null;
    completedAt?: Date | string | null;
    createdAt?: Date | string | null;
  }) {
    return {
      id: milestone.id,
      projectId: milestone.projectId,
      name: milestone.name,
      description: milestone.description,
      dueDate: milestone.dueDate ? new Date(milestone.dueDate).toISOString() : null,
      completedAt: milestone.completedAt ? new Date(milestone.completedAt).toISOString() : null,
      createdAt: milestone.createdAt
        ? new Date(milestone.createdAt).toISOString()
        : new Date().toISOString(),
    };
  }

  private deliverableSyncPayload(deliverable: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    status: string;
    dueDate?: Date | string | null;
    acceptedAt?: Date | string | null;
    createdAt?: Date | string | null;
  }) {
    return {
      id: deliverable.id,
      projectId: deliverable.projectId,
      title: deliverable.title,
      description: deliverable.description,
      status: deliverable.status,
      dueDate: deliverable.dueDate ? new Date(deliverable.dueDate).toISOString() : null,
      acceptedAt: deliverable.acceptedAt ? new Date(deliverable.acceptedAt).toISOString() : null,
      createdAt: deliverable.createdAt
        ? new Date(deliverable.createdAt).toISOString()
        : new Date().toISOString(),
    };
  }

  private deliveryRecordSyncPayload(delivery: {
    id: string;
    projectId: string;
    summary: string | null;
    status: string;
    deliveredAt?: Date | string | null;
    acceptedAt?: Date | string | null;
    createdAt?: Date | string | null;
  }) {
    return {
      id: delivery.id,
      projectId: delivery.projectId,
      summary: delivery.summary,
      status: delivery.status,
      deliveredAt: delivery.deliveredAt ? new Date(delivery.deliveredAt).toISOString() : null,
      acceptedAt: delivery.acceptedAt ? new Date(delivery.acceptedAt).toISOString() : null,
      createdAt: delivery.createdAt
        ? new Date(delivery.createdAt).toISOString()
        : new Date().toISOString(),
    };
  }

  private deliveryChecklistItemSyncPayload(
    item: {
      id: string;
      deliveryId: string;
      title: string;
      checked: boolean;
      createdAt?: Date | string | null;
    },
    projectId: string,
  ) {
    return {
      id: item.id,
      deliveryId: item.deliveryId,
      projectId,
      title: item.title,
      checked: item.checked,
      createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
    };
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
