import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  PROJECT_PERMISSIONS,
  ProjectAction,
  WORKSPACE_PERMISSIONS,
  WorkspaceAction,
} from '../../../src/authz/permissions';
import { PolicyService } from '../../../src/authz/policy.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { OTHER_W, Persona, USERS, W, buildRbacPrisma, id } from '../../support/rbac-fixture';

/** A2 / S12 : matrice RBAC table-driven sur la politique centrale (utilisateur x projet x action). */
describe('PolicyService : matrice RBAC', () => {
  let policy: PolicyService;

  beforeEach(() => {
    policy = new PolicyService(buildRbacPrisma() as unknown as PrismaService);
  });

  const allowed = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return false;
      throw error;
    }
  };

  // Rôle effectif attendu par persona sur P1 et P2 (null = aucun accès)
  const EXPECTED_ROLE: Record<Persona, { P1: string | null; P2: string | null }> = {
    owner: { P1: 'MANAGER', P2: 'MANAGER' },
    admin: { P1: 'MANAGER', P2: 'MANAGER' },
    member: { P1: null, P2: null },
    contributor: { P1: 'CONTRIBUTOR', P2: null },
    commenter: { P1: 'COMMENTER', P2: null },
    viewer: { P1: null, P2: null },
    client: { P1: 'CLIENT', P2: null },
    outsider: { P1: null, P2: null },
    // S12-a : plus de Membership, donc plus aucun rôle même avec une ProjectMembership
    deprovisioned: { P1: null, P2: null },
  };
  const RANK: Record<string, number> = { MANAGER: 4, CONTRIBUTOR: 3, COMMENTER: 2, CLIENT: 1 };

  const projectCases = (Object.keys(EXPECTED_ROLE) as Persona[]).flatMap((persona) =>
    (['P1', 'P2'] as const).flatMap((name) =>
      (Object.keys(PROJECT_PERMISSIONS) as ProjectAction[]).map((action) => {
        const projectId = id(name);
        const role = EXPECTED_ROLE[persona][name];
        const min = Math.min(...PROJECT_PERMISSIONS[action].map((r: string) => RANK[r]));
        return [persona, projectId, action, role !== null && RANK[role] >= min] as const;
      }),
    ),
  );

  it.each(projectCases)('%s sur %s : %s -> %s', async (persona, projectId, action, expected) => {
    expect(await allowed(() => policy.assertProject(projectId, USERS[persona], action))).toBe(
      expected,
    );
  });

  it.each(projectCases.filter(([, , action]) => action === 'task.read'))(
    '%s sur %s : une tâche du projet suit la même règle (%s)',
    async (persona, projectId, _action, expected) => {
      const taskId = projectId === id('P1') ? id('T1') : id('T2');
      expect(await allowed(() => policy.assertTask(taskId, USERS[persona], 'task.read'))).toBe(
        expected,
      );
    },
  );

  const WS_EXPECTED: Record<Persona, string | null> = {
    owner: 'OWNER',
    admin: 'ADMIN',
    member: 'MEMBER',
    contributor: 'MEMBER',
    commenter: 'MEMBER',
    viewer: 'VIEWER',
    client: 'VIEWER',
    outsider: null,
    deprovisioned: null,
  };
  const workspaceCases = (Object.keys(WS_EXPECTED) as Persona[]).flatMap((persona) =>
    (Object.keys(WORKSPACE_PERMISSIONS) as WorkspaceAction[]).map((action) => {
      const role = WS_EXPECTED[persona];
      const roles: readonly string[] = WORKSPACE_PERMISSIONS[action];
      return [persona, action, role !== null && roles.includes(role)] as const;
    }),
  );

  it.each(workspaceCases)('workspace : %s, %s -> %s', async (persona, action, expected) => {
    expect(await allowed(() => policy.assertWorkspace(W, USERS[persona], action))).toBe(expected);
  });

  it('un VIEWER ne gère ni ne lit les sprints (P11), un MEMBER les lit', async () => {
    expect(await allowed(() => policy.assertWorkspace(W, USERS.viewer, 'sprint.manage'))).toBe(
      false,
    );
    expect(await allowed(() => policy.assertWorkspace(W, USERS.viewer, 'sprint.read'))).toBe(false);
    expect(await allowed(() => policy.assertWorkspace(W, USERS.member, 'sprint.read'))).toBe(true);
  });

  it('un membre d’un autre workspace n’a aucun accès, ni projet ni workspace', async () => {
    expect(await allowed(() => policy.assertWorkspace(W, USERS.outsider, 'workspace.read'))).toBe(
      false,
    );
    expect(
      await allowed(() => policy.assertProject(id('P1'), USERS.outsider, 'project.read')),
    ).toBe(false);
    expect(await policy.listAccessibleProjectIds(USERS.outsider, { workspaceId: W })).toEqual([]);
  });

  it('projet inexistant ou supprimé : 404', async () => {
    await expect(policy.assertProject('absent', USERS.owner, 'project.read')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('tâche inexistante : 404', async () => {
    await expect(policy.assertTask('absente', USERS.owner, 'task.read')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe("S12-a : l'appartenance au workspace conditionne tout rôle de projet", () => {
    const setup = () => {
      const prisma = buildRbacPrisma();
      // Projets créés par l'utilisateur 'bob' : un de workspace (P-bob), un personnel (P-perso)
      prisma.data.projects.push(
        { id: 'P-bob', name: 'bob', userId: 'bob', workspaceId: W, deletedAt: null },
        { id: 'P-perso', name: 'perso', userId: 'bob', workspaceId: null, deletedAt: null },
      );
      prisma.data.projectMemberships.push({
        id: 'pm-bob',
        projectId: id('P2'),
        userId: 'bob',
        role: 'CONTRIBUTOR',
      });
      const membership = { id: 'm-bob', workspaceId: W, userId: 'bob', role: 'MEMBER' };
      prisma.data.memberships.push(membership);
      const removeMembership = () =>
        prisma.data.memberships.splice(prisma.data.memberships.indexOf(membership), 1);
      return { policy: new PolicyService(prisma as unknown as PrismaService), removeMembership };
    };

    it('membre : le créateur et le détenteur d’une ProjectMembership ont accès', async () => {
      const { policy } = setup();
      expect(await allowed(() => policy.assertProject('P-bob', 'bob', 'task.write'))).toBe(true);
      expect(await allowed(() => policy.assertProject(id('P2'), 'bob', 'task.write'))).toBe(true);
      expect((await policy.listAccessibleProjectIds('bob')).sort()).toEqual(
        ['P-bob', 'P-perso', id('P2')].sort(),
      );
    });

    it('après suppression de la Membership : 403 pour le créateur et pour la ProjectMembership', async () => {
      const { policy, removeMembership } = setup();
      removeMembership();
      expect(await allowed(() => policy.assertProject('P-bob', 'bob', 'project.read'))).toBe(false);
      expect(await allowed(() => policy.assertProject(id('P2'), 'bob', 'task.write'))).toBe(false);
      await expect(policy.assertProject('P-bob', 'bob', 'project.read')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('après suppression de la Membership : plus rien dans listAccessibleProjectIds (hors projet personnel)', async () => {
      const { policy, removeMembership } = setup();
      removeMembership();
      expect(await policy.listAccessibleProjectIds('bob')).toEqual(['P-perso']);
      expect(await policy.listAccessibleProjectIds('bob', { workspaceId: W })).toEqual([]);
    });

    it('projet personnel : le créateur garde l’accès, un tiers non', async () => {
      const { policy, removeMembership } = setup();
      removeMembership();
      expect(await allowed(() => policy.assertProject('P-perso', 'bob', 'project.manage'))).toBe(
        true,
      );
      expect(
        await allowed(() => policy.assertProject('P-perso', USERS.owner, 'project.read')),
      ).toBe(false);
    });
  });

  describe('listAccessibleProjectIds', () => {
    it.each([
      ['owner', [id('P1'), id('P2')]],
      ['admin', [id('P1'), id('P2')]],
      ['member', []],
      ['contributor', [id('P1')]],
      ['commenter', [id('P1')]],
      ['viewer', []],
      ['client', [id('P1')]],
      ['deprovisioned', []],
    ] as const)('%s : %j', async (persona, expected) => {
      expect((await policy.listAccessibleProjectIds(USERS[persona])).sort()).toEqual(expected);
      expect(
        (await policy.listAccessibleProjectIds(USERS[persona], { workspaceId: W })).sort(),
      ).toEqual(expected);
    });

    it('un membre d’un autre workspace ne voit que son propre projet (PX), jamais ceux de W', async () => {
      expect(await policy.listAccessibleProjectIds(USERS.outsider)).toEqual([id('PX')]);
      expect(await policy.listAccessibleProjectIds(USERS.outsider, { workspaceId: W })).toEqual([]);
    });

    it('borné à un autre workspace : aucun projet de W', async () => {
      expect(await policy.listAccessibleProjectIds(USERS.owner, { workspaceId: OTHER_W })).toEqual(
        [],
      );
    });

    it('selon l’action : un COMMENTER n’a pas task.write', async () => {
      expect(
        await policy.listAccessibleProjectIds(USERS.commenter, { action: 'task.write' }),
      ).toEqual([]);
      expect(
        await policy.listAccessibleProjectIds(USERS.commenter, { action: 'comment.write' }),
      ).toEqual([id('P1')]);
    });
  });
});
