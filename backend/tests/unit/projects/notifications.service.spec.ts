import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from '../../../src/notifications/notifications.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { NotificationsGateway } from '../../../src/notifications/notifications.gateway';
import { MailService } from '../../../src/mail/mail.service';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';
import { NotFoundException } from '@nestjs/common';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrisma = {
    $transaction: jest.fn(),
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    task: {
      findFirst: jest.fn(),
    },
  };

  const mockGateway = {
    sendNotificationToUser: jest.fn(),
  };

  const mockMailService = {
    sendMentionEmail: jest.fn().mockResolvedValue(undefined),
  };

  const mockFirestoreSync = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation((callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsGateway, useValue: mockGateway },
        { provide: MailService, useValue: mockMailService },
        { provide: FirestoreSyncService, useValue: mockFirestoreSync },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('createNotification', () => {
    it('should create a notification and enqueue sync event', async () => {
      const notifData = {
        userId: 'user-1',
        senderId: 'user-2',
        type: 'ASSIGNMENT',
        title: 'Nouvelle tâche',
        content: 'Vous avez été assigné à une tâche.',
        projectId: 'project-1',
      };

      mockPrisma.project.findFirst.mockResolvedValue({
        workspaceId: 'workspace-1',
      });

      const createdNotif = {
        id: 'notif-1',
        ...notifData,
        senderId: 'user-2',
        taskId: null,
        read: false,
        createdAt: new Date('2026-06-01T10:00:00Z'),
        sender: { id: 'user-2', name: 'Alice', email: 'alice@test.com' },
      };

      mockPrisma.notification.create.mockResolvedValue(createdNotif);

      const result = await service.createNotification(notifData);

      expect(result).toEqual(createdNotif);
      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'notification',
          entityId: 'notif-1',
          workspaceId: 'workspace-1',
          operation: 'upsert',
        }),
      );
      expect(mockGateway.sendNotificationToUser).toHaveBeenCalledWith(
        'user-1',
        'new-notification',
        createdNotif,
      );
    });

    it('should use personal partition when no projectId', async () => {
      const notifData = {
        userId: 'user-1',
        type: 'SYSTEM',
        title: 'Bienvenue',
        content: 'Bienvenue sur Planner Pro.',
      };

      const createdNotif = {
        id: 'notif-2',
        userId: 'user-1',
        senderId: null,
        type: 'SYSTEM',
        title: 'Bienvenue',
        content: 'Bienvenue sur Planner Pro.',
        taskId: null,
        projectId: null,
        read: false,
        createdAt: new Date('2026-06-01T10:00:00Z'),
        sender: null,
      };

      mockPrisma.notification.create.mockResolvedValue(createdNotif);

      await service.createNotification(notifData);

      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          workspaceId: 'personal-user-1',
        }),
      );
    });
  });

  describe('markAsRead', () => {
    it('should mark a notification as read and enqueue sync event', async () => {
      const notification = {
        id: 'notif-1',
        userId: 'user-1',
        projectId: 'project-1',
        read: false,
      };

      mockPrisma.notification.findFirst.mockResolvedValue(notification);
      mockPrisma.project.findFirst.mockResolvedValue({
        workspaceId: 'workspace-1',
      });

      const updatedNotif = {
        ...notification,
        read: true,
        senderId: null,
        type: 'ASSIGNMENT',
        title: 'Tâche',
        content: 'Contenu',
        taskId: null,
        createdAt: new Date('2026-06-01T10:00:00Z'),
        sender: null,
      };

      mockPrisma.notification.update.mockResolvedValue(updatedNotif);

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(result).toEqual(updatedNotif);
      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'notification',
          entityId: 'notif-1',
          operation: 'upsert',
          workspaceId: 'workspace-1',
        }),
      );
    });

    it('should throw NotFoundException if notification not found', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markAsRead('notif-404', 'user-1')).rejects.toThrow(NotFoundException);

      expect(mockFirestoreSync.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('markAllAsRead', () => {
    it('should update all unread notifications', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllAsRead('user-1');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', read: false },
        data: { read: true },
      });
    });
  });

  describe('getUserNotifications', () => {
    it('should return notifications for the user', async () => {
      const notifs = [
        {
          id: 'notif-1',
          userId: 'user-1',
          type: 'SYSTEM',
          title: 'Test',
          content: 'Content',
          read: false,
          sender: null,
        },
      ];

      mockPrisma.notification.findMany.mockResolvedValue(notifs);

      const result = await service.getUserNotifications('user-1');

      expect(result).toEqual(notifs);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: {
          sender: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
