import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectRole } from '@prisma/client';

@Injectable()
export class ProjectPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async assertWorkspaceAccess(
    workspaceId: string,
    userId: string,
    allowedRoles: Array<'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'> = [
      'OWNER',
      'ADMIN',
      'MEMBER',
      'VIEWER',
    ],
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        workspaceId,
        userId,
        role: { in: allowedRoles },
        workspace: { deletedAt: null },
      },
    });

    if (!membership) {
      throw new ForbiddenException('Accès non autorisé au workspace');
    }

    return membership;
  }

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

    await this.logAction(actorUserId, 'PROJECT_ROLE_ASSIGN', 'ProjectMembership', membership.id, {
      projectId,
      targetUserId,
      role,
    });

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

    await this.logAction(actorUserId, 'PROJECT_ROLE_REMOVE', 'ProjectMembership', membership.id, {
      projectId,
      targetUserId,
    });

    return { success: true };
  }

  /**
   * Récupère tous les membres d'un projet et leurs rôles.
   */
  async getProjectMembers(projectId: string, userId: string) {
    // L'utilisateur doit avoir un accès minimal de lecture
    await this.assertProjectRole(projectId, userId, [
      'MANAGER',
      'CONTRIBUTOR',
      'COMMENTER',
      'CLIENT',
    ]);

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
      throw new ForbiddenException('Accès non autorisé au projet');
    }

    // Si MANAGER fait partie des rôles attendus et que l'utilisateur est MANAGER
    if (allowedRoles.includes(projectMembership.role as ProjectRole)) {
      return;
    }

    // Si on cherche d'autres rôles et que l'utilisateur a un rôle suffisant (hiérarchie des rôles)
    const roleHierarchy = {
      MANAGER: 4,
      CONTRIBUTOR: 3,
      COMMENTER: 2,
      CLIENT: 1,
    };

    const userRoleValue = roleHierarchy[projectMembership.role] || 0;

    // Trouver la valeur maximale des rôles autorisés
    const requiredRoleValues = allowedRoles.map((r) => roleHierarchy[r]);
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
    changes: Record<string, unknown>,
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
    } catch (err: unknown) {
      console.error("Échec d'écriture du log d'audit :", err);
    }
  }

  /**
   * Récupère l'historique d'audit du projet ou global.
   */
  async getAuditLogs(userId: string, workspaceId: string, limit = 100) {
    await this.assertWorkspaceAccess(workspaceId, userId, ['OWNER', 'ADMIN']);

    const projects = await this.prisma.projectMembership.findMany({
      where: { project: { workspaceId, deletedAt: null } },
      select: { id: true },
    });
    const workspaceProjects = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true },
    });
    const projectIds = workspaceProjects.map((project) => project.id);
    const projectMembershipIds = projects.map((membership) => membership.id);
    const tasks = await this.prisma.task.findMany({
      where: { projectId: { in: projectIds }, deletedAt: null },
      select: { id: true },
    });

    const entityFilters = [
      { entityType: 'Project', entityId: { in: projectIds } },
      { entityType: 'Task', entityId: { in: tasks.map((task) => task.id) } },
      { entityType: 'ProjectMembership', entityId: { in: projectMembershipIds } },
    ];

    return this.prisma.auditLog.findMany({
      where: { OR: entityFilters },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Récupère l'historique d'audit spécifique à un projet.
   * L'utilisateur doit avoir le rôle MANAGER sur le projet (ou être OWNER/ADMIN du workspace).
   */
  async getProjectAuditLogs(projectId: string, userId: string, limit = 50) {
    await this.assertProjectRole(projectId, userId, ['MANAGER']);

    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      select: { id: true },
    });
    const memberships = await this.prisma.projectMembership.findMany({
      where: { projectId },
      select: { id: true },
    });

    const entityFilters = [
      { entityType: 'Project', entityId: projectId },
      { entityType: 'Task', entityId: { in: tasks.map((t) => t.id) } },
      { entityType: 'ProjectMembership', entityId: { in: memberships.map((m) => m.id) } },
    ];

    return this.prisma.auditLog.findMany({
      where: { OR: entityFilters },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }
}
