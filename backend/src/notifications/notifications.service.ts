import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
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

    return notification;
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
