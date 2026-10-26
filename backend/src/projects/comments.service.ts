import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationService } from './integration.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';

export type CommentWithRelations = Prisma.CommentGetPayload<{
  include: {
    user: {
      select: { id: true; name: true; email: true };
    };
    attachments: true;
  };
}>;

export type CommentWithReplies = CommentWithRelations & {
  replies: CommentWithReplies[];
};

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationService: IntegrationService,
    private readonly notificationsService: NotificationsService,
    private readonly firestoreSync: FirestoreSyncService,
  ) {}

  private async assertWorkspaceAccess(workspaceId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        workspaceId,
        userId,
        workspace: { deletedAt: null },
      },
    });

    if (!membership) {
      throw new ForbiddenException("Vous n'êtes pas membre de cet espace de travail.");
    }
    return membership;
  }

  async createComment(
    taskId: string,
    userId: string,
    content: string,
    parentId?: string,
    attachments?: { fileName: string; fileUrl: string; fileType: string; fileSize: number }[],
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: { project: true },
    });

    if (!task) {
      throw new NotFoundException('Tâche introuvable.');
    }

    if (!task.project.workspaceId) {
      throw new BadRequestException("Cette tâche n'est pas liée à un workspace.");
    }

    // Vérifier l'accès au workspace de la tâche
    await this.assertWorkspaceAccess(task.project.workspaceId, userId);

    if (parentId) {
      const parent = await this.prisma.comment.findFirst({
        where: { id: parentId, taskId },
      });
      if (!parent) {
        throw new NotFoundException('Commentaire parent introuvable.');
      }
    }

    // Enregistrer le commentaire
    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          content,
          taskId,
          userId,
          parentId,
          attachments: attachments
            ? {
                createMany: {
                  data: attachments,
                },
              }
            : undefined,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          attachments: true,
        },
      });

      await this.firestoreSync.enqueue(tx, {
        entityType: 'comment',
        entityId: created.id,
        workspaceId: task.project.workspaceId!,
        operation: 'upsert',
        payload: this.commentSyncPayload(created, task.projectId),
      });

      for (const att of created.attachments) {
        await this.firestoreSync.enqueue(tx, {
          entityType: 'attachment',
          entityId: att.id,
          workspaceId: task.project.workspaceId!,
          operation: 'upsert',
          payload: this.attachmentSyncPayload(att, task.projectId),
        });
      }

      return created;
    });

    // Détecter les mentions
    const mentionedUserIds = await this.parseMentions(content, task.project.workspaceId);

    // Envoyer les notifications aux utilisateurs mentionnés (sauf l'auteur)
    const authorName = comment.user.name || comment.user.email;
    for (const id of mentionedUserIds) {
      if (id !== userId) {
        await this.notificationsService.createNotification({
          userId: id,
          senderId: userId,
          type: 'MENTION',
          title: 'Nouvelle mention',
          content: `${authorName} vous a mentionné dans un commentaire sur la tâche "${task.title}".`,
          taskId: taskId,
          projectId: task.projectId,
        });
      }
    }

    // Déclencher le webhook de notification pour un nouveau commentaire
    this.integrationService.sendNotification(
      task.project.workspaceId,
      'Nouveau Commentaire',
      `Un nouveau commentaire a été ajouté par ${comment.user.name || comment.user.email} sur la tâche "${task.title}" : "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`,
    );

    return {
      comment,
      mentionedUserIds,
    };
  }

  async listComments(taskId: string, userId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: { project: true },
    });

    if (!task) {
      throw new NotFoundException('Tâche introuvable.');
    }

    if (!task.project.workspaceId) {
      throw new BadRequestException("Cette tâche n'est pas liée à un workspace.");
    }

    // Vérifier l'accès
    await this.assertWorkspaceAccess(task.project.workspaceId, userId);

    const allDbComments = await this.prisma.comment.findMany({
      where: { taskId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        attachments: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const commentMap = new Map<string, CommentWithReplies>();
    allDbComments.forEach((c) => {
      commentMap.set(c.id, { ...c, replies: [] });
    });

    const roots: CommentWithReplies[] = [];
    allDbComments.forEach((c) => {
      const mapped = commentMap.get(c.id);
      if (!mapped) return;
      if (c.parentId) {
        const parent = commentMap.get(c.parentId);
        if (parent) {
          parent.replies.push(mapped);
        } else {
          roots.push(mapped);
        }
      } else {
        roots.push(mapped);
      }
    });

    return roots;
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        task: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException('Commentaire introuvable.');
    }

    const workspaceId = comment.task.project.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException("Cette tâche n'est pas liée à un workspace.");
    }

    // Vérifier si l'utilisateur est l'auteur du commentaire
    const isAuthor = comment.userId === userId;

    if (!isAuthor) {
      // Si ce n'est pas l'auteur, vérifier si c'est un ADMIN ou OWNER du workspace
      const membership = await this.assertWorkspaceAccess(workspaceId, userId);
      if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
        throw new ForbiddenException("Vous n'êtes pas autorisé à supprimer ce commentaire.");
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.comment.delete({
        where: { id: commentId },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'comment',
        entityId: commentId,
        workspaceId,
        operation: 'delete',
        payload: {
          id: commentId,
          taskId: comment.taskId,
          projectId: comment.task.projectId,
          deletedAt: new Date().toISOString(),
        },
      });
      return deleted;
    });
  }

  async updateComment(commentId: string, userId: string, content: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        task: {
          include: {
            project: {
              select: { workspaceId: true, id: true },
            },
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException('Commentaire introuvable.');
    }

    const workspaceId = comment.task.project.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException("Cette tâche n'est pas liée à un workspace.");
    }

    // Seul l'auteur a le droit de modifier son propre commentaire
    if (comment.userId !== userId) {
      throw new ForbiddenException("Vous n'êtes pas autorisé à modifier ce commentaire.");
    }

    const updatedComment = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { content },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'comment',
        entityId: updated.id,
        workspaceId,
        operation: 'upsert',
        payload: this.commentSyncPayload(updated, comment.task.projectId),
      });
      return updated;
    });

    // Détecter de nouvelles mentions dans le contenu modifié
    const mentionedUserIds = await this.parseMentions(content, workspaceId);

    // Envoyer les notifications aux utilisateurs mentionnés (sauf l'auteur)
    const authorName = updatedComment.user.name || updatedComment.user.email;
    for (const id of mentionedUserIds) {
      if (id !== userId) {
        await this.notificationsService.createNotification({
          userId: id,
          senderId: userId,
          type: 'MENTION',
          title: 'Nouvelle mention',
          content: `${authorName} vous a mentionné dans un commentaire modifié sur la tâche "${comment.task.title}".`,
          taskId: comment.taskId,
          projectId: comment.task.projectId,
        });
      }
    }

    return {
      comment: updatedComment,
      mentionedUserIds,
    };
  }

  async parseMentions(content: string, workspaceId: string): Promise<string[]> {
    const mentionRegex = /@([a-zA-Z0-9._@-]+)/g;
    const matches = [...content.matchAll(mentionRegex)];
    if (matches.length === 0) return [];

    const mentionedUserIds: string[] = [];
    const members = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: true },
    });

    for (const match of matches) {
      const search = match[1].toLowerCase();
      // Trouver un membre dont le nom ou l'e-mail correspond à la mention
      const foundMember = members.find((m) => {
        const nameMatch = m.user.name?.toLowerCase().includes(search);
        const emailPrefix = m.user.email.toLowerCase().split('@')[0];
        return nameMatch || emailPrefix === search || m.user.email.toLowerCase() === search;
      });

      if (foundMember && !mentionedUserIds.includes(foundMember.userId)) {
        mentionedUserIds.push(foundMember.userId);
      }
    }

    return mentionedUserIds;
  }

  // --- CRUD Pièces jointes (Attachment) ---

  async createAttachmentForTask(
    taskId: string,
    userId: string,
    fileName: string,
    fileUrl: string,
    fileType: string,
    fileSize: number,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: { project: true },
    });
    if (!task) {
      throw new NotFoundException('Tâche introuvable.');
    }
    if (!task.project.workspaceId) {
      throw new BadRequestException("Cette tâche n'est pas liée à un workspace.");
    }
    await this.assertWorkspaceAccess(task.project.workspaceId, userId);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          fileName,
          fileUrl,
          fileType,
          fileSize,
          taskId,
        },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'attachment',
        entityId: created.id,
        workspaceId: task.project.workspaceId!,
        operation: 'upsert',
        payload: this.attachmentSyncPayload(created, task.projectId),
      });
      return created;
    });
  }

  async getAttachmentsForTask(taskId: string, userId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: { project: true },
    });
    if (!task) {
      throw new NotFoundException('Tâche introuvable.');
    }
    if (!task.project.workspaceId) {
      throw new BadRequestException("Cette tâche n'est pas liée à un workspace.");
    }
    await this.assertWorkspaceAccess(task.project.workspaceId, userId);

    return this.prisma.attachment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteAttachment(attachmentId: string, userId: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        task: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!attachment) {
      throw new NotFoundException('Pièce jointe introuvable.');
    }

    const workspaceId = attachment.task?.project.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException(
        "Cette pièce jointe n'est pas liée à une tâche dans un workspace.",
      );
    }

    await this.assertWorkspaceAccess(workspaceId, userId);

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.attachment.delete({
        where: { id: attachmentId },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'attachment',
        entityId: attachmentId,
        workspaceId,
        operation: 'delete',
        payload: {
          id: attachmentId,
          taskId: attachment.taskId,
          deletedAt: new Date().toISOString(),
        },
      });
      return deleted;
    });
  }

  private commentSyncPayload(
    comment: {
      id: string;
      content: string;
      taskId: string;
      userId: string;
      parentId?: string | null;
      createdAt?: Date | string | null;
      updatedAt?: Date | string | null;
    },
    projectId: string,
  ) {
    const createdAtDate = comment.createdAt ? new Date(comment.createdAt) : new Date();
    const updatedAtDate = comment.updatedAt ? new Date(comment.updatedAt) : createdAtDate;
    return {
      id: comment.id,
      content: comment.content,
      taskId: comment.taskId,
      projectId,
      userId: comment.userId,
      parentId: comment.parentId ?? null,
      createdAt: createdAtDate.toISOString(),
      updatedAt: updatedAtDate.toISOString(),
    };
  }

  private attachmentSyncPayload(
    attachment: {
      id: string;
      fileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
      taskId?: string | null;
      commentId?: string | null;
      createdAt?: Date | string | null;
    },
    projectId: string,
  ) {
    const createdAtDate = attachment.createdAt ? new Date(attachment.createdAt) : new Date();
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      fileUrl: attachment.fileUrl,
      fileType: attachment.fileType,
      fileSize: attachment.fileSize,
      taskId: attachment.taskId ?? null,
      commentId: attachment.commentId ?? null,
      projectId,
      createdAt: createdAtDate.toISOString(),
    };
  }
}
