/**
 * Fixture RBAC pour les tests d'autorisation (A2, S12) : un workspace W avec deux projets P1 et
 * P2, une tâche par projet et des utilisateurs de tous les rôles. Le faux Prisma évalue les
 * requêtes de la politique d'autorisation à partir de ces données, sans base de données.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Identifiant UUID déterministe d'une entité logique de la fixture (`id('P1')`, `id('T2')`...).
 * Les routes exigent des UUID dans l'URL (S23) : le nom logique (6 caractères au plus) est encodé
 * dans les derniers octets, ce qui garde les identifiants lisibles et stables d'un test à l'autre.
 */
export const id = (name: string): string =>
  `00000000-0000-4000-8000-${Buffer.from(name).toString('hex').padStart(12, '0')}`;

export const W = id('ws-1');
export const OTHER_W = id('ws-2');

// Identifiants au format UUID v4 : les DTO (ex. `AssignProjectRoleDto`) exigent un UUID (S17)
export const USERS = {
  owner: '00000000-0000-4000-8000-000000000001',
  admin: '00000000-0000-4000-8000-000000000002',
  member: '00000000-0000-4000-8000-000000000003', // MEMBER sans ProjectMembership
  contributor: '00000000-0000-4000-8000-000000000004', // MEMBER + CONTRIBUTOR sur P1
  commenter: '00000000-0000-4000-8000-000000000005', // MEMBER + COMMENTER sur P1
  viewer: '00000000-0000-4000-8000-000000000006', // VIEWER sans ProjectMembership
  client: '00000000-0000-4000-8000-000000000007', // VIEWER + CLIENT sur P1
  outsider: '00000000-0000-4000-8000-000000000008', // membre d'un AUTRE workspace
  deprovisioned: '00000000-0000-4000-8000-000000000009', // ProjectMembership CONTRIBUTOR sur P1 mais plus de Membership (désactivé par SCIM)
} as const;

export type Persona = keyof typeof USERS;

export function buildRbacData() {
  const memberships: Row[] = [
    { id: 'm1', workspaceId: W, userId: USERS.owner, role: 'OWNER' },
    { id: 'm2', workspaceId: W, userId: USERS.admin, role: 'ADMIN' },
    { id: 'm3', workspaceId: W, userId: USERS.member, role: 'MEMBER' },
    { id: 'm4', workspaceId: W, userId: USERS.contributor, role: 'MEMBER' },
    { id: 'm5', workspaceId: W, userId: USERS.commenter, role: 'MEMBER' },
    { id: 'm6', workspaceId: W, userId: USERS.viewer, role: 'VIEWER' },
    { id: 'm7', workspaceId: W, userId: USERS.client, role: 'VIEWER' },
    { id: 'm8', workspaceId: OTHER_W, userId: USERS.outsider, role: 'OWNER' },
  ];
  const projects: Row[] = [
    { id: id('P1'), name: 'Projet 1', userId: USERS.owner, workspaceId: W, deletedAt: null },
    { id: id('P2'), name: 'Projet 2', userId: USERS.owner, workspaceId: W, deletedAt: null },
    // Projet d'un AUTRE workspace (autre locataire)
    {
      id: id('PX'),
      name: 'Projet X',
      userId: USERS.outsider,
      workspaceId: OTHER_W,
      deletedAt: null,
    },
  ];
  const projectMemberships: Row[] = [
    { id: 'pm1', projectId: id('P1'), userId: USERS.owner, role: 'MANAGER' },
    { id: 'pm2', projectId: id('P2'), userId: USERS.owner, role: 'MANAGER' },
    { id: 'pm3', projectId: id('P1'), userId: USERS.contributor, role: 'CONTRIBUTOR' },
    { id: 'pm4', projectId: id('P1'), userId: USERS.commenter, role: 'COMMENTER' },
    { id: 'pm5', projectId: id('P1'), userId: USERS.client, role: 'CLIENT' },
    { id: 'pm6', projectId: id('P1'), userId: USERS.deprovisioned, role: 'CONTRIBUTOR' },
  ];
  const tasks: Row[] = [
    { id: id('T1'), title: 'Tâche 1', projectId: id('P1'), userId: USERS.owner, deletedAt: null },
    { id: id('T2'), title: 'Tâche 2', projectId: id('P2'), userId: USERS.owner, deletedAt: null },
    {
      id: id('TX'),
      title: 'Tâche X',
      projectId: id('PX'),
      userId: USERS.outsider,
      deletedAt: null,
    },
  ];
  return { memberships, projects, projectMemberships, tasks };
}

type Where = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Évalue un `where` Prisma limité aux formes utilisées par la politique (et par l'ancien code). */
function matchesWhere(
  row: Row,
  where: Where | undefined,
  data: ReturnType<typeof buildRbacData>,
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((w) => matchesWhere(row, w, data));
    if (key === 'AND') return (cond as Where[]).every((w) => matchesWhere(row, w, data));
    if (key === 'workspace') {
      // Relation workspace : { deletedAt: null } (workspace actif) ou { memberships: { some } }
      if ('memberships' in cond) {
        return data.memberships.some(
          (m) =>
            m.workspaceId === row.workspaceId &&
            Object.entries(cond.memberships.some).every(([k, v]) => m[k] === v),
        );
      }
      return true;
    }
    if (key === 'projectMemberships') {
      return data.projectMemberships.some(
        (pm) => pm.projectId === row.id && Object.entries(cond.some).every(([k, v]) => pm[k] === v),
      );
    }
    if (key === 'project') {
      const project = data.projects.find((p) => p.id === row.projectId);
      return !!project && matchesWhere(project, cond, data);
    }
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(row[key]);
      if ('not' in cond) return row[key] !== cond.not;
      return true;
    }
    return row[key] === cond;
  });
}

export function buildRbacPrisma() {
  const data = buildRbacData();
  const find = (rows: Row[], where?: Where) => rows.filter((r) => matchesWhere(r, where, data));
  const withProject = (task: Row | undefined) =>
    task ? { ...task, project: data.projects.find((p) => p.id === task.projectId) } : null;
  const prisma = {
    data,
    membership: {
      findFirst: jest.fn(async ({ where }: { where?: Where } = {}) => {
        const { workspace: _ws, ...rest } = where ?? {};
        const found = find(data.memberships, rest)[0];
        return found ? { ...found, workspace: { id: found.workspaceId, deletedAt: null } } : null;
      }),
      findMany: jest.fn(async ({ where }: { where?: Where } = {}) => {
        const { workspace: _ws, ...rest } = where ?? {};
        return find(data.memberships, rest);
      }),
    },
    project: {
      findFirst: jest.fn(
        async ({ where }: { where?: Where } = {}) => find(data.projects, where)[0] ?? null,
      ),
      findUnique: jest.fn(
        async ({ where }: { where?: Where } = {}) => find(data.projects, where)[0] ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where?: Where } = {}) => find(data.projects, where)),
    },
    projectMembership: {
      findUnique: jest.fn(async ({ where }: { where: Where }) => {
        const { projectId, userId } = where.projectId_userId;
        return (
          data.projectMemberships.find((p) => p.projectId === projectId && p.userId === userId) ??
          null
        );
      }),
      findMany: jest.fn(async ({ where }: { where?: Where } = {}) =>
        find(data.projectMemberships, where),
      ),
    },
    task: {
      updateMany: jest.fn(async (_args?: any) => ({ count: 0 })), // eslint-disable-line @typescript-eslint/no-explicit-any
      findFirst: jest.fn(async ({ where }: { where?: Where } = {}) =>
        withProject(find(data.tasks, where)[0]),
      ),
      findUnique: jest.fn(async ({ where }: { where?: Where } = {}) =>
        withProject(find(data.tasks, where)[0]),
      ),
      findMany: jest.fn(async ({ where }: { where?: Where } = {}) =>
        find(data.tasks, where).map(withProject),
      ),
    },
  };
  return prisma;
}
