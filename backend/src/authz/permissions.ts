/**
 * Matrice de permissions unique (A2, S12) : action -> rôles autorisés.
 *
 * Règles de lecture :
 * - Rôles de workspace : OWNER, ADMIN, MEMBER, VIEWER.
 * - Rôles de projet : MANAGER > CONTRIBUTOR > COMMENTER > CLIENT. Un rôle est accepté s'il est au
 *   moins égal au plus faible des rôles listés pour l'action.
 * - OWNER et ADMIN du workspace sont MANAGER implicites de tous les projets de ce workspace.
 * - Le créateur d'un projet en est MANAGER.
 * - Un MEMBER ou un VIEWER SANS `ProjectMembership` n'a AUCUN accès au projet (règle par défaut de
 *   S12, cohérente avec `getProject`). Décision produit P4 tranchée par l'utilisateur le
 *   2026-11-03 : règle stricte, aucun accès implicite. La reprise des accès existants est le script
 *   optionnel `scripts/grant-legacy-project-access.ts` (docs/security/runbook-phase3.md § 2).
 */
export type WorkspaceRoleName = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type ProjectRoleName = 'MANAGER' | 'CONTRIBUTOR' | 'COMMENTER' | 'CLIENT';

const ALL_WORKSPACE: WorkspaceRoleName[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];
const CONTRIBUTE_WORKSPACE: WorkspaceRoleName[] = ['OWNER', 'ADMIN', 'MEMBER'];
const ADMIN_WORKSPACE: WorkspaceRoleName[] = ['OWNER', 'ADMIN'];

export const WORKSPACE_PERMISSIONS = {
  'workspace.read': ALL_WORKSPACE,
  'project.create': CONTRIBUTE_WORKSPACE,
  'sprint.read': ALL_WORKSPACE,
  'sprint.manage': CONTRIBUTE_WORKSPACE,
  'ai.use': CONTRIBUTE_WORKSPACE,
  'schedule.run': CONTRIBUTE_WORKSPACE,
  'workspace.integrations.manage': ADMIN_WORKSPACE,
  'workspace.invitations.manage': ADMIN_WORKSPACE,
  'workspace.audit.read': ADMIN_WORKSPACE,
  'workspace.finances.read': ADMIN_WORKSPACE,
  'workspace.resources.manage': ADMIN_WORKSPACE,
  'milestone.manage': ADMIN_WORKSPACE,
} as const satisfies Record<string, readonly WorkspaceRoleName[]>;

const READ_PROJECT: ProjectRoleName[] = ['MANAGER', 'CONTRIBUTOR', 'COMMENTER', 'CLIENT'];
const WRITE_PROJECT: ProjectRoleName[] = ['MANAGER', 'CONTRIBUTOR'];
const COMMENT_PROJECT: ProjectRoleName[] = ['MANAGER', 'CONTRIBUTOR', 'COMMENTER'];
const MANAGE_PROJECT: ProjectRoleName[] = ['MANAGER'];

export const PROJECT_PERMISSIONS = {
  'project.read': READ_PROJECT,
  'project.write': WRITE_PROJECT,
  'project.manage': MANAGE_PROJECT,
  'task.read': READ_PROJECT,
  'task.write': WRITE_PROJECT,
  'comment.read': READ_PROJECT,
  'comment.write': COMMENT_PROJECT,
  'comment.delete': MANAGE_PROJECT,
  'attachment.read': READ_PROJECT,
  'attachment.write': COMMENT_PROJECT,
  'attachment.delete': MANAGE_PROJECT,
  'timelog.read': WRITE_PROJECT,
  'timelog.write': WRITE_PROJECT,
} as const satisfies Record<string, readonly ProjectRoleName[]>;

export type WorkspaceAction = keyof typeof WORKSPACE_PERMISSIONS;
export type ProjectAction = keyof typeof PROJECT_PERMISSIONS;

/** Rang d'un rôle de projet : plus il est élevé, plus le rôle est puissant. */
export const PROJECT_ROLE_RANK: Record<ProjectRoleName, number> = {
  MANAGER: 4,
  CONTRIBUTOR: 3,
  COMMENTER: 2,
  CLIENT: 1,
};
