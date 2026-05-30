import { Test, TestingModule } from '@nestjs/testing';
import { CommentsService } from './comments.service';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationService } from './integration.service';
import { WorkspaceRole } from '@prisma/client';

describe('CommentsService', () => {
  let service: CommentsService;
  let prisma: PrismaService;

  const mockPrisma = {
    membership: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    task: {
      findFirst: jest.fn(),
    },
    comment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockIntegration = {
    sendNotification: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IntegrationService, useValue: mockIntegration },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('createComment', () => {
    const taskId = 'task-123';
    const userId = 'user-auth';
    const workspaceId = 'workspace-123';

    it('devrait rejeter si la tâche n\'existe pas', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(
        service.createComment(taskId, userId, 'Nouveau commentaire')
      ).rejects.toThrow(/Tâche introuvable/);
    });

    it('devrait rejeter si l\'utilisateur n\'a pas accès au workspace', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({
        id: taskId,
        project: { workspaceId },
      });
      mockPrisma.membership.findFirst.mockResolvedValue(null);

      await expect(
        service.createComment(taskId, userId, 'Nouveau commentaire')
      ).rejects.toThrow(/Vous n'êtes pas membre/);
    });

    it('devrait créer le commentaire et parser les mentions avec succès', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({
        id: taskId,
        project: { workspaceId },
      });
      mockPrisma.membership.findFirst.mockResolvedValue({
        role: WorkspaceRole.MEMBER,
      });
      
      const mockCreatedComment = {
        id: 'comment-123',
        content: 'Hello @alice, regarde ça.',
        taskId,
        userId,
        user: { id: userId, name: 'Auteur', email: 'auteur@test.com' },
      };
      mockPrisma.comment.create.mockResolvedValue(mockCreatedComment);

      // Pour le parseMentions
      mockPrisma.membership.findMany.mockResolvedValue([
        { userId: 'alice-id', user: { id: 'alice-id', name: 'Alice Smith', email: 'alice@test.com' } },
        { userId: 'bob-id', user: { id: 'bob-id', name: 'Bob Jones', email: 'bob@test.com' } },
      ]);

      const result = await service.createComment(taskId, userId, 'Hello @alice, regarde ça.');

      expect(result.comment).toEqual(mockCreatedComment);
      expect(result.mentionedUserIds).toContain('alice-id');
      expect(result.mentionedUserIds).not.toContain('bob-id');
      expect(mockPrisma.comment.create).toHaveBeenCalledWith({
        data: {
          content: 'Hello @alice, regarde ça.',
          taskId,
          userId,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    });
  });

  describe('deleteComment', () => {
    const commentId = 'comment-123';
    const userId = 'user-auth';
    const workspaceId = 'workspace-123';

    it('devrait autoriser la suppression si l\'utilisateur est l\'auteur', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: commentId,
        userId: userId, // L'auteur
        task: {
          project: { workspaceId },
        },
      });

      mockPrisma.comment.delete.mockResolvedValue({ id: commentId });

      await service.deleteComment(commentId, userId);

      expect(mockPrisma.comment.delete).toHaveBeenCalledWith({
        where: { id: commentId },
      });
    });

    it('devrait rejeter si l\'utilisateur n\'est pas l\'auteur et est un membre normal', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: commentId,
        userId: 'autre-auteur',
        task: {
          project: { workspaceId },
        },
      });

      mockPrisma.membership.findFirst.mockResolvedValue({
        role: WorkspaceRole.MEMBER, // Pas admin/owner
      });

      await expect(
        service.deleteComment(commentId, userId)
      ).rejects.toThrow(/Vous n'êtes pas autorisé/);
    });

    it('devrait autoriser la suppression si l\'utilisateur n\'est pas l\'auteur mais est admin ou owner', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: commentId,
        userId: 'autre-auteur',
        task: {
          project: { workspaceId },
        },
      });

      mockPrisma.membership.findFirst.mockResolvedValue({
        role: WorkspaceRole.ADMIN, // Admin
      });

      mockPrisma.comment.delete.mockResolvedValue({ id: commentId });

      await service.deleteComment(commentId, userId);

      expect(mockPrisma.comment.delete).toHaveBeenCalledWith({
        where: { id: commentId },
      });
    });
  });

  describe('updateComment', () => {
    const commentId = 'comment-123';
    const userId = 'user-auth';
    const workspaceId = 'workspace-123';

    it('devrait rejeter si le commentaire n\'existe pas', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue(null);

      await expect(
        service.updateComment(commentId, userId, 'Contenu modifié')
      ).rejects.toThrow(/Commentaire introuvable/);
    });

    it('devrait rejeter si l\'utilisateur n\'est pas l\'auteur', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: commentId,
        userId: 'autre-auteur',
        task: {
          project: { workspaceId },
        },
      });

      await expect(
        service.updateComment(commentId, userId, 'Contenu modifié')
      ).rejects.toThrow(/Vous n'êtes pas autorisé/);
    });

    it('devrait modifier le commentaire et parser les mentions', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: commentId,
        userId: userId,
        task: {
          project: { workspaceId },
        },
      });

      const mockUpdatedComment = {
        id: commentId,
        content: 'Nouveau @alice',
        userId,
        taskId: 'task-123',
        user: { id: userId, name: 'Auteur', email: 'auteur@test.com' },
      };
      mockPrisma.comment.update.mockResolvedValue(mockUpdatedComment);

      mockPrisma.membership.findMany.mockResolvedValue([
        { userId: 'alice-id', user: { id: 'alice-id', name: 'Alice Smith', email: 'alice@test.com' } },
      ]);

      const result = await service.updateComment(commentId, userId, 'Nouveau @alice');

      expect(result.comment).toEqual(mockUpdatedComment);
      expect(result.mentionedUserIds).toContain('alice-id');
      expect(mockPrisma.comment.update).toHaveBeenCalledWith({
        where: { id: commentId },
        data: { content: 'Nouveau @alice' },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    });
  });

  describe('parseMentions', () => {
    it('devrait extraire les ID utilisateurs mentionnés par leur e-mail ou prénom', async () => {
      const workspaceId = 'workspace-123';
      mockPrisma.membership.findMany.mockResolvedValue([
        { userId: 'alice-id', user: { id: 'alice-id', name: 'Alice Smith', email: 'alice@planner.pro' } },
        { userId: 'bob-id', user: { id: 'bob-id', name: 'Bob Le Bricoleur', email: 'bob@test.com' } },
      ]);

      const mentions1 = await service.parseMentions('Hello @alice, comment ça va ?', workspaceId);
      expect(mentions1).toContain('alice-id');

      const mentions2 = await service.parseMentions('Bravo @bob@test.com et @alice', workspaceId);
      expect(mentions2).toContain('bob-id');
      expect(mentions2).toContain('alice-id');

      const mentionsNone = await service.parseMentions('Pas de mentions ici.', workspaceId);
      expect(mentionsNone).toEqual([]);
    });
  });
});
