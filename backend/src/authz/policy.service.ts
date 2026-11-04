import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PROJECT_PERMISSIONS,
  PROJECT_ROLE_RANK,
  ProjectAction,
  ProjectRoleName,
  WORKSPACE_PERMISSIONS,
  WorkspaceAction,
  WorkspaceRoleName,
} from './permissions';

/**
 * Politique d'autorisation centrale (A2, S12) : seul point de décision pour l'appartenance à un
 * workspace, les rôles de workspace et les rôles de projet. Aucun service ne doit réimplémenter
 * ces contrôles. Refus par défaut.
 */
@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Workspace ──────────────────────────────────────────────────────

  /** Membership dans un workspace non supprimé, ou 403. */
  async assertWorkspaceMember(workspaceId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { workspaceId, userId, workspace: { deletedAt: null } },
    });
    if (!membership) {
      throw new ForbiddenException('Workspace not found or unauthorized');
    }
    return membership;
  }

  /** Membership avec l'un des rôles donnés, ou 403. */
  async assertWorkspaceRoles(
    workspaceId: string,
    userId: string,
    allowedRoles: readonly WorkspaceRoleName[],
  ) {
    const membership = await this.assertWorkspaceMember(workspaceId, userId);
    if (!allowedRoles.includes(membership.role as WorkspaceRoleName)) {
      throw new ForbiddenException('Unauthorized: insufficient workspace permissions');
    }
    return membership;
  }

  /** Vérifie une action de workspace de la matrice. */
  assertWorkspace(workspaceId: string, userId: string, action: WorkspaceAction) {
    return this.assertWorkspaceRoles(workspaceId, userId, WORKSPACE_PERMISSIONS[action]);
  }

  /** Identifiants des workspaces (non supprimés) dont l'utilisateur est membre. */
  async listWorkspaceIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, workspace: { deletedAt: null } },
      select: { workspaceId: true },
    });
    return memberships.map((m) => m.workspaceId);
  }

  /** Identifiants des OWNER et ADMIN d'un workspace non supprimé (MANAGER de tous ses projets). */
  async listWorkspaceAdminIds(workspaceId: string): Promise<string[]> {
    const admins = await this.prisma.membership.findMany({
      where: {
        workspaceId,
        role: { in: ['OWNER', 'ADMIN'] },
        workspace: { deletedAt: null },
      },
      select: { userId: true },
    });
    return admins.map((m) => m.userId);
  }

  /**
   * Utilisateurs du workspace que l'appelant a le droit de voir (P11). Avec
   * `workspace.directory.read` (OWNER, ADMIN, MEMBER) : tous les membres. Un VIEWER (invité) ne voit
   * que lui-même, les OWNER/ADMIN (MANAGER implicites) et les personnes qui ont accès à au moins un
   * projet qu'il peut lire. Seuls les titulaires d'une `Membership` du workspace sont renvoyés.
   * 403 si l'appelant n'est pas membre.
   */
  async listVisibleWorkspaceMemberIds(workspaceId: string, userId: string): Promise<string[]> {
    const caller = await this.assertWorkspaceMember(workspaceId, userId);
    const members = await this.prisma.membership.findMany({
      where: { workspaceId, workspace: { deletedAt: null } },
      select: { userId: true, role: true },
    });
    if (WORKSPACE_PERMISSIONS['workspace.directory.read'].includes(caller.role as never)) {
      return members.map((m) => m.userId);
    }

    const memberRole = new Map(members.map((m) => [m.userId, m.role]));
    const visible = new Set<string>([userId]);
    for (const m of members) {
      if (m.role === 'OWNER' || m.role === 'ADMIN') visible.add(m.userId);
    }
    const projectIds = await this.listAccessibleProjectIds(userId, { workspaceId });
    if (projectIds.length > 0) {
      const projects = await this.prisma.project.findMany({
        where: { id: { in: projectIds }, deletedAt: null },
        select: { id: true, userId: true },
      });
      const grants = await this.prisma.projectMembership.findMany({
        where: { projectId: { in: projectIds } },
        select: { userId: true },
      });
      // Créateurs (au moins MEMBER, P10) et titulaires d'un rôle de projet, s'ils sont membres
      for (const project of projects) {
        if (this.creatorIsManager(memberRole.get(project.userId))) visible.add(project.userId);
      }
      for (const grant of grants) visible.add(grant.userId);
    }
    return members.map((m) => m.userId).filter((id) => visible.has(id));
  }

  // ─── Projet ─────────────────────────────────────────────────────────

  /**
   * Rôle de projet effectif de l'utilisateur, ou null s'il n'a aucun accès.
   * Un projet de workspace n'ouvre AUCUN rôle (créateur, `ProjectMembership`, OWNER/ADMIN) sans
   * `Membership` dans ce workspace : un compte déprovisionné (SCIM) perd tout accès (S12-a).
   * OWNER/ADMIN du workspace et créateur sont MANAGER ; un MEMBER ou VIEWER sans
   * `ProjectMembership` n'a aucun accès (S12). Un projet personnel (sans workspace) reste réservé
   * à son créateur.
   */
  async effectiveProjectRole(
    project: { id: string; userId: string; workspaceId: string | null },
    userId: string,
  ): Promise<ProjectRoleName | null> {
    if (!project.workspaceId) {
      return project.userId === userId ? 'MANAGER' : null;
    }
    const membership = await this.prisma.membership.findFirst({
      where: { workspaceId: project.workspaceId, userId, workspace: { deletedAt: null } },
    });
    if (!membership) return null;
    if (membership.role === 'OWNER' || membership.role === 'ADMIN') return 'MANAGER';
    if (project.userId === userId && this.creatorIsManager(membership.role)) return 'MANAGER';
    const projectMembership = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId: project.id, userId } },
    });
    return (projectMembership?.role as ProjectRoleName | undefined) ?? null;
  }

  /**
   * Le créateur d'un projet de workspace n'en est MANAGER que s'il est au moins MEMBER du
   * workspace (P10) : un créateur rétrogradé VIEWER retombe sur sa `ProjectMembership` éventuelle.
   */
  private creatorIsManager(workspaceRole: string | null | undefined): boolean {
    return workspaceRole === 'OWNER' || workspaceRole === 'ADMIN' || workspaceRole === 'MEMBER';
  }

  /** Rôle accepté s'il est au moins égal au plus faible des rôles autorisés. */
  private roleSatisfies(role: ProjectRoleName, allowed: readonly ProjectRoleName[]): boolean {
    const required = Math.min(...allowed.map((r) => PROJECT_ROLE_RANK[r]));
    return PROJECT_ROLE_RANK[role] >= required;
  }

  /** Projet non supprimé et rôle de projet suffisant, ou 404 / 403. Renvoie le projet. */
  async assertProjectRoles(
    projectId: string,
    userId: string,
    allowedRoles: readonly ProjectRoleName[],
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) {
      throw new NotFoundException('Projet introuvable');
    }
    const role = await this.effectiveProjectRole(project, userId);
    if (!role) {
      throw new ForbiddenException('Accès non autorisé au projet');
    }
    if (!this.roleSatisfies(role, allowedRoles)) {
      throw new ForbiddenException('Permissions de projet insuffisantes');
    }
    return project;
  }

  /** Vérifie une action de projet de la matrice. */
  assertProject(projectId: string, userId: string, action: ProjectAction) {
    return this.assertProjectRoles(projectId, userId, PROJECT_PERMISSIONS[action]);
  }

  /**
   * Charge une tâche non supprimée avec son projet et vérifie l'action sur ce projet.
   * 404 si la tâche n'existe pas, 403 si l'accès est refusé (jamais de fuite de contenu).
   */
  async assertTask(taskId: string, userId: string, action: ProjectAction) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: { project: true },
    });
    if (!task) {
      throw new NotFoundException('Tâche introuvable.');
    }
    await this.assertProject(task.projectId, userId, action);
    return task;
  }

  /**
   * Variante de `assertTask` pour les routes dont le contrat historique répond 400 : tâche absente
   * et accès refusé donnent exactement la même réponse (pas d'oracle d'existence).
   */
  async assertTaskOrBadRequest(
    taskId: string,
    userId: string,
    action: ProjectAction,
    message: string,
  ) {
    try {
      return await this.assertTask(taskId, userId, action);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw new BadRequestException(message);
      }
      throw error;
    }
  }

  /**
   * Parmi `taskIds`, ceux des tâches non supprimées qui appartiennent à l'un des `projectIds`
   * (typiquement les projets accessibles à l'utilisateur), en une requête. Sert à révoquer les
   * salons temps réel `task:<id>` (S16-a).
   */
  async filterTaskIdsInProjects(taskIds: string[], projectIds: string[]): Promise<string[]> {
    if (taskIds.length === 0 || projectIds.length === 0) return [];
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds }, deletedAt: null },
      select: { id: true, projectId: true },
    });
    const allowed = new Set(projectIds);
    return tasks.filter((t) => allowed.has(t.projectId)).map((t) => t.id);
  }

  /**
   * Parmi `userIds`, ceux qui ont l'action donnée sur le projet (mêmes règles que `assertProject`),
   * en deux requêtes. Sert à ne notifier ou assigner que des personnes autorisées (S12-c).
   */
  async filterUsersWithProjectAction(
    projectId: string,
    userIds: string[],
    action: ProjectAction,
  ): Promise<string[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) return [];
    if (!project.workspaceId) return ids.filter((id) => id === project.userId);

    const allowed = PROJECT_PERMISSIONS[action];
    const memberships = await this.prisma.membership.findMany({
      where: {
        workspaceId: project.workspaceId,
        userId: { in: ids },
        workspace: { deletedAt: null },
      },
      select: { userId: true, role: true },
    });
    const projectMemberships = await this.prisma.projectMembership.findMany({
      where: { projectId, userId: { in: ids } },
      select: { userId: true, role: true },
    });
    const granted = new Map(
      projectMemberships.map((pm) => [pm.userId, pm.role as ProjectRoleName]),
    );
    return memberships
      .filter((m) => {
        const role: ProjectRoleName | undefined =
          m.role === 'OWNER' ||
          m.role === 'ADMIN' ||
          (project.userId === m.userId && this.creatorIsManager(m.role))
            ? 'MANAGER'
            : granted.get(m.userId);
        return !!role && this.roleSatisfies(role, allowed);
      })
      .map((m) => m.userId);
  }

  /**
   * Identifiants des projets sur lesquels l'utilisateur a l'action donnée (lecture par défaut),
   * éventuellement bornés à un workspace dont il est membre. Un non-membre obtient une liste vide.
   */
  async listAccessibleProjectIds(
    userId: string,
    options: { workspaceId?: string; action?: ProjectAction } = {},
  ): Promise<string[]> {
    const roles = PROJECT_PERMISSIONS[options.action ?? 'project.read'];
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        workspace: { deletedAt: null },
      },
      select: { workspaceId: true, role: true },
    });
    const memberWorkspaceIds = memberships.map((m) => m.workspaceId);
    const creatorWorkspaceIds = memberships
      .filter((m) => this.creatorIsManager(m.role))
      .map((m) => m.workspaceId);
    const adminWorkspaceIds = memberships
      .filter((m) => m.role === 'OWNER' || m.role === 'ADMIN')
      .map((m) => m.workspaceId);

    const projectMemberships = await this.prisma.projectMembership.findMany({
      where: { userId },
      select: { projectId: true, role: true },
    });
    const grantedIds = projectMemberships
      .filter((pm) => this.roleSatisfies(pm.role as ProjectRoleName, roles))
      .map((pm) => pm.projectId);

    // Chaque branche exige l'appartenance au workspace du projet (S12-a) ; seul un projet
    // personnel (sans workspace) reste réservé à son créateur.
    const scope = options.workspaceId ? { workspaceId: options.workspaceId } : {};
    const projects = await this.prisma.project.findMany({
      where: {
        deletedAt: null,
        ...scope,
        OR: [
          // Créateur : seulement dans les workspaces où il est au moins MEMBER (P10)
          { userId, workspaceId: { in: creatorWorkspaceIds } },
          { id: { in: grantedIds }, workspaceId: { in: memberWorkspaceIds } },
          ...(adminWorkspaceIds.length > 0 ? [{ workspaceId: { in: adminWorkspaceIds } }] : []),
          ...(options.workspaceId ? [] : [{ userId, workspaceId: null }]),
        ],
      },
      select: { id: true, workspaceId: true },
    });
    if (options.workspaceId && memberships.length === 0) return [];
    return projects.map((p) => p.id);
  }
}
