import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectRole } from '@prisma/client';

@Injectable()
export class ProjectPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assigne ou met à jour le rôle d'un utilisateur sur un projet.
   * L'appelant doit être OWNER/ADMIN du workspace parent ou MANAGER du projet.
   */
  async assignProjectRole(
    projectId: string,
    targetUserId: string,
    role: ProjectRole,
    actorUserId: string,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
    });

    if (!project) {
      throw new NotFoundException('Projet introuvable');
    }

    // Valider les permissions de l'acteur (OWNER/ADMIN du workspace ou MANAGER du projet)
    await this.assertProjectRole(projectId, actorUserId, ['MANAGER']);

    const membership = await this.prisma.projectMembership.upsert({
      where: {
        projectId_userId: { projectId, userId: targetUserId },
      },
      create: {
        projectId,
        userId: targetUserId,
        role,
      },
      update: {
        role,
      },
    });

    await this.logAction(
      actorUserId,
      'PROJECT_ROLE_ASSIGN',
      'ProjectMembership',
      membership.id,
      { projectId, targetUserId, role },
    );

    return membership;
  }

  /**
   * Supprime l'accès d'un utilisateur à un projet.
   */
  async removeProjectRole(projectId: string, targetUserId: string, actorUserId: string) {
    await this.assertProjectRole(projectId, actorUserId, ['MANAGER']);

    const membership = await this.prisma.projectMembership.findUnique({
      where: {
        projectId_userId: { projectId, userId: targetUserId },
      },
    });

    if (!membership) {
      throw new NotFoundException('Accès projet introuvable pour cet utilisateur');
    }

    await this.prisma.projectMembership.delete({
      where: { id: membership.id },
    });

    await this.logAction(
      actorUserId,
      'PROJECT_ROLE_REMOVE',
      'ProjectMembership',
      membership.id,
      { projectId, targetUserId },
    );

    return { success: true };
  }

  /**
   * Récupère tous les membres d'un projet et leurs rôles.
   */
  async getProjectMembers(projectId: string, userId: string) {
    // L'utilisateur doit avoir un accès minimal de lecture
    await this.assertProjectRole(projectId, userId, ['MANAGER', 'CONTRIBUTOR', 'COMMENTER', 'CLIENT']);

    return this.prisma.projectMembership.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Vérifie si un utilisateur possède l'un des rôles autorisés sur le projet.
   * L'OWNER ou l'ADMIN du workspace a automatiquement tous les droits ( MANAGER ).
   */
  async assertProjectRole(
    projectId: string,
    userId: string,
    allowedRoles: Array<'MANAGER' | 'CONTRIBUTOR' | 'COMMENTER' | 'CLIENT'>,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: { workspace: true },
    });

    if (!project) {
      throw new NotFoundException('Projet introuvable');
    }

    // 1. Si l'utilisateur est le créateur direct du projet
    if (project.userId === userId) {
      return; // A accès total
    }

    // 2. Si le projet est dans un workspace, vérifier si l'utilisateur est OWNER/ADMIN
    if (project.workspaceId) {
      const workspaceMembership = await this.prisma.membership.findFirst({
        where: {
          workspaceId: project.workspaceId,
          userId,
          workspace: { deletedAt: null },
        },
      });

      if (workspaceMembership) {
        // Un OWNER ou ADMIN du workspace a un contrôle MANAGER par défaut
        if (workspaceMembership.role === 'OWNER' || workspaceMembership.role === 'ADMIN') {
          return; 
        }
      }
    }

    // 3. Vérifier le rôle au niveau du projet
    const projectMembership = await this.prisma.projectMembership.findUnique({
      where: {
        projectId_userId: { projectId, userId },
      },
    });

    if (!projectMembership) {
      throw new ForbiddenException("Accès non autorisé au projet");
    }

    // Si MANAGER fait partie des rôles attendus et que l'utilisateur est MANAGER
    if (allowedRoles.includes(projectMembership.role as any)) {
      return;
    }

    // Si on cherche d'autres rôles et que l'utilisateur a un rôle suffisant (hiérarchie des rôles)
    const roleHierarchy = {
      'MANAGER': 4,
      'CONTRIBUTOR': 3,
      'COMMENTER': 2,
      'CLIENT': 1,
    };

    const userRoleValue = roleHierarchy[projectMembership.role] || 0;
    
    // Trouver la valeur maximale des rôles autorisés
    const requiredRoleValues = allowedRoles.map(r => roleHierarchy[r]);
    const minRequiredRoleValue = Math.min(...requiredRoleValues);

    if (userRoleValue >= minRequiredRoleValue) {
      return;
    }

    throw new ForbiddenException('Permissions de projet insuffisantes');
  }

  /**
   * Enregistre une action mutative dans la table d'audit.
   */
  async logAction(
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    changes: any,
    ipAddress?: string,
  ) {
    try {
      return await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entityType,
          entityId,
          changes: changes ? JSON.stringify(changes) : {},
          ipAddress: ipAddress || null,
        },
      });
    } catch (err) {
      console.error("Échec d'écriture du log d'audit :", err);
    }
  }

  /**
   * Récupère l'historique d'audit du projet ou global.
   */
  async getAuditLogs(userId: string, limit = 100) {
    // Réservé aux admins / owners globaux
    const defaultWorkspace = await this.prisma.membership.findFirst({
      where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
    });

    if (!defaultWorkspace) {
      throw new ForbiddenException('Accès aux logs d\'audit refusé');
    }

    return this.prisma.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }
}
