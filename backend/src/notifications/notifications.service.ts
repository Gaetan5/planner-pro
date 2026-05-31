import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { MailService } from '../mail/mail.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly mailService: MailService,
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
    const notification = await this.prisma.notification.create({
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

    // Émettre l'événement temps réel
    this.gateway.sendNotificationToUser(data.userId, 'new-notification', notification);

    // Envoi d'email asynchrone si c'est une mention
    if (data.type === 'MENTION') {
      this.sendMentionEmailAsync(notification).catch(err => {
        console.error("Erreur lors du déclenchement asynchrone de l'email de mention :", err);
      });
    }

    return notification;
  }

  private async sendMentionEmailAsync(notification: any) {
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

      const senderName = notification.sender?.name || notification.sender?.email || 'Un collaborateur';
      
      await this.mailService.sendMentionEmail(
        recipient.email,
        senderName,
        taskTitle,
        notification.content,
      );
    } catch (error) {
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

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
      include: {
        sender: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    return { success: true };
  }
}
