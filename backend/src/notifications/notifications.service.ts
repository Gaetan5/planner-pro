import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { MailService } from '../mail/mail.service';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';
import { Notification, Prisma } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly mailService: MailService,
    private readonly firestoreSync: FirestoreSyncService,
  ) {}

  async createNotification(data: {
    userId: string;
    senderId?: string;
    type: string;
    title: string;
    content: string;
    taskId?: string;
    projectId?: string;
  }) {
    const workspaceId = await this.resolveWorkspaceId(data.projectId, data.userId);

    const notification = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.notification.create({
        data: {
          userId: data.userId,
          senderId: data.senderId || null,
          type: data.type,
          title: data.title,
          content: data.content,
          taskId: data.taskId || null,
          projectId: data.projectId || null,
        },
        include: {
          sender: { select: { id: true, name: true, email: true } },
        },
      });

      await this.firestoreSync.enqueue(tx, {
        entityType: 'notification',
        entityId: created.id,
        workspaceId,
        operation: 'upsert',
        payload: this.notificationSyncPayload(created),
      });

      return created;
    });

    // Émettre l'événement temps réel
    this.gateway.sendNotificationToUser(data.userId, 'new-notification', notification);

    // Envoi d'email asynchrone si c'est une mention
    if (data.type === 'MENTION') {
      this.sendMentionEmailAsync(notification).catch((err) => {
        console.error("Erreur lors du déclenchement asynchrone de l'email de mention :", err);
      });
    }

    return notification;
  }

  private async sendMentionEmailAsync(
    notification: Notification & {
      sender?: { name?: string | null; email?: string | null } | null;
    },
  ) {
    try {
      const recipient = await this.prisma.user.findUnique({
        where: { id: notification.userId },
        select: { name: true, email: true },
      });

      if (!recipient || !recipient.email) return;

      let taskTitle = 'Tâche';
      if (notification.taskId) {
        const task = await this.prisma.task.findFirst({
          where: { id: notification.taskId, deletedAt: null },
          select: { title: true },
        });
        if (task) taskTitle = task.title;
      }

      const senderName =
        notification.sender?.name || notification.sender?.email || 'Un collaborateur';

      await this.mailService.sendMentionEmail(
        recipient.email,
        senderName,
        taskTitle,
        notification.content,
      );
    } catch (error: unknown) {
      console.error("Erreur lors de la préparation de l'email de mention :", error);
    }
  }

  async getUserNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      include: {
        sender: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification non trouvée');
    }

    const workspaceId = await this.resolveWorkspaceId(notification.projectId ?? undefined, userId);

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const result = await tx.notification.update({
        where: { id: notificationId },
        data: { read: true },
        include: {
          sender: { select: { id: true, name: true, email: true } },
        },
      });

      await this.firestoreSync.enqueue(tx, {
        entityType: 'notification',
        entityId: result.id,
        workspaceId,
        operation: 'upsert',
        payload: this.notificationSyncPayload(result),
      });

      return result;
    });

    return updated;
  }

  async markAllAsRead(userId: string) {
    // markAllAsRead est un updateMany, pas de payload individuel à sync —
    // les notifications lues ne sont pas critiques pour Firestore.
    // On fait un bulk update simple sans outbox unitaire.
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    return { success: true };
  }

  /**
   * Résout le workspaceId depuis le projectId associé à la notification.
   * Fallback sur `personal-${userId}` si pas de projet ou si le projet
   * n'a pas de workspace.
   */
  private async resolveWorkspaceId(projectId: string | undefined, userId: string): Promise<string> {
    if (projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { workspaceId: true },
      });
      if (project?.workspaceId) {
        return project.workspaceId;
      }
    }
    return `personal-${userId}`;
  }

  private notificationSyncPayload(notification: {
    id: string;
    userId: string;
    senderId: string | null;
    type: string;
    title: string;
    content: string;
    read: boolean;
    taskId: string | null;
    projectId: string | null;
    createdAt?: Date | string | null;
  }) {
    return {
      id: notification.id,
      userId: notification.userId,
      senderId: notification.senderId,
      type: notification.type,
      title: notification.title,
      content: notification.content,
      read: notification.read,
      taskId: notification.taskId,
      projectId: notification.projectId,
      createdAt: notification.createdAt
        ? new Date(notification.createdAt).toISOString()
        : new Date().toISOString(),
    };
  }
}
