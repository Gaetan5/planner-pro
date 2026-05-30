import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async createComment(taskId: string, userId: string, content: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: { project: true },
    });

    if (!task) {
      throw new NotFoundException("Tâche introuvable.");
    }

    if (!task.project.workspaceId) {
      throw new BadRequestException("Cette tâche n'est pas liée à un workspace.");
    }

    // Vérifier l'accès au workspace de la tâche
    await this.assertWorkspaceAccess(task.project.workspaceId, userId);

    // Enregistrer le commentaire
    const comment = await this.prisma.comment.create({
      data: {
        content,
        taskId,
        userId,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Détecter les mentions
    const mentionedUserIds = await this.parseMentions(content, task.project.workspaceId);

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
      throw new NotFoundException("Tâche introuvable.");
    }

    if (!task.project.workspaceId) {
      throw new BadRequestException("Cette tâche n'est pas liée à un workspace.");
    }

    // Vérifier l'accès
    await this.assertWorkspaceAccess(task.project.workspaceId, userId);

    return this.prisma.comment.findMany({
      where: { taskId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
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
      throw new NotFoundException("Commentaire introuvable.");
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

    return this.prisma.comment.delete({
      where: { id: commentId },
    });
  }

  async updateComment(commentId: string, userId: string, content: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        task: {
          include: {
            project: {
              select: { workspaceId: true },
            },
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException("Commentaire introuvable.");
    }

    const workspaceId = comment.task.project.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException("Cette tâche n'est pas liée à un workspace.");
    }

    // Seul l'auteur a le droit de modifier son propre commentaire
    if (comment.userId !== userId) {
      throw new ForbiddenException("Vous n'êtes pas autorisé à modifier ce commentaire.");
    }

    const updatedComment = await this.prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Détecter de nouvelles mentions dans le contenu modifié
    const mentionedUserIds = await this.parseMentions(content, workspaceId);

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
      const foundMember = members.find(m => {
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
}
