import { PrismaClient } from '@prisma/client';
import {
  planGenericSsoCleanup,
  runGenericSsoCleanup,
  GenericSsoUser,
} from '../../../scripts/cleanup-generic-sso';
import {
  planSyncTaskReassignments,
  runSimulatedCalendarCleanup,
} from '../../../scripts/cleanup-simulated-calendar';
import { toCsv } from '../../../scripts/lib/csv';

/**
 * S28 : scripts de reprise des données compromises de la Phase 0.
 * Aucune écriture sans --apply ; transformations conformes au rapport ; idempotence.
 */
const genericUser = (overrides: Partial<GenericSsoUser> = {}): GenericSsoUser => ({
  id: 'u-gen',
  email: 'user@acme.com',
  passwordHash: null,
  firebaseUid: null,
  githubId: null,
  ssoUid: 'generic:acme.com:x',
  memberships: [{ workspaceId: 'ws-saml', role: 'ADMIN', ssoProvider: 'SAML2' }],
  ...overrides,
});

describe('S28 : planGenericSsoCleanup', () => {
  it('retire la membership obtenue via SAML2/OIDC_GENERIC, efface ssoUid et suspend un compte sans autre accès', () => {
    const [entry] = planGenericSsoCleanup([genericUser()]);
    expect(entry.removeMembershipWorkspaceIds).toEqual(['ws-saml']);
    expect(entry.keptOwnerWorkspaceIds).toEqual([]);
    expect(entry.clearSsoUid).toBe(true);
    expect(entry.suspend).toBe(true);
  });

  it('une membership OWNER est signalée, jamais supprimée, et le compte n’est pas suspendu', () => {
    const [entry] = planGenericSsoCleanup([
      genericUser({
        memberships: [{ workspaceId: 'ws-saml', role: 'OWNER', ssoProvider: 'OIDC_GENERIC' }],
      }),
    ]);
    expect(entry.removeMembershipWorkspaceIds).toEqual([]);
    expect(entry.keptOwnerWorkspaceIds).toEqual(['ws-saml']);
    expect(entry.suspend).toBe(false);
  });

  it('une membership dans un workspace sans SSO générique est conservée', () => {
    const [entry] = planGenericSsoCleanup([
      genericUser({
        memberships: [
          { workspaceId: 'ws-saml', role: 'MEMBER', ssoProvider: 'SAML2' },
          { workspaceId: 'ws-perso', role: 'OWNER', ssoProvider: null },
          { workspaceId: 'ws-azure', role: 'MEMBER', ssoProvider: 'OIDC_AZURE_AD' },
        ],
      }),
    ]);
    expect(entry.removeMembershipWorkspaceIds).toEqual(['ws-saml']);
    expect(entry.suspend).toBe(false);
  });

  it.each([
    ['passwordHash', { passwordHash: 'argon2...' }],
    ['firebaseUid', { firebaseUid: 'fb-1' }],
    ['githubId', { githubId: '42' }],
  ])('un compte disposant de %s n’est pas suspendu', (_label, extra) => {
    const [entry] = planGenericSsoCleanup([genericUser(extra)]);
    expect(entry.suspend).toBe(false);
    expect(entry.clearSsoUid).toBe(true);
  });
});

describe('S28 : runGenericSsoCleanup', () => {
  const makePrisma = (users: GenericSsoUser[]) => {
    const tx = {
      membership: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue(
          users.map((u) => ({
            ...u,
            memberships: u.memberships.map((m) => ({
              workspaceId: m.workspaceId,
              role: m.role,
              workspace: { ssoConfiguration: m.ssoProvider ? { provider: m.ssoProvider } : null },
            })),
          })),
        ),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    return { prisma, tx };
  };

  it('mode rapport : aucune écriture, aucune transaction', async () => {
    const { prisma, tx } = makePrisma([genericUser()]);
    const result = await runGenericSsoCleanup(prisma as unknown as PrismaClient, { apply: false });
    expect(result.plan).toHaveLength(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.membership.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('--apply : suppressions ciblées (jamais OWNER), ssoUid effacé et suspension, dans une transaction', async () => {
    const { prisma, tx } = makePrisma([genericUser()]);
    await runGenericSsoCleanup(prisma as unknown as PrismaClient, { apply: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.membership.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u-gen', workspaceId: { in: ['ws-saml'] }, role: { not: 'OWNER' } },
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-gen', ssoUid: { startsWith: 'generic:' } },
      data: { ssoUid: null, isSuspended: true },
    });
  });

  it('idempotence : sans compte generic:% restant, --apply ne modifie rien', async () => {
    const { prisma, tx } = makePrisma([]);
    const result = await runGenericSsoCleanup(prisma as unknown as PrismaClient, { apply: true });
    expect(result.plan).toHaveLength(0);
    expect(tx.membership.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ssoUid: { startsWith: 'generic:' } } }),
    );
  });
});

describe('S28 : planSyncTaskReassignments', () => {
  it('réattribue au propriétaire du workspace une tâche possédée par un non-membre', () => {
    const plan = planSyncTaskReassignments([
      {
        taskId: 't-1',
        workspaceId: 'ws-1',
        ownerId: 'owner-1',
        userId: 'etranger',
        userIsMember: false,
      },
    ]);
    expect(plan).toEqual([
      { taskId: 't-1', workspaceId: 'ws-1', oldUserId: 'etranger', newUserId: 'owner-1' },
    ]);
  });

  it('ne réattribue pas une tâche dont le propriétaire est membre (ou est le propriétaire)', () => {
    expect(
      planSyncTaskReassignments([
        {
          taskId: 't-1',
          workspaceId: 'ws-1',
          ownerId: 'owner-1',
          userId: 'membre',
          userIsMember: true,
        },
        {
          taskId: 't-2',
          workspaceId: 'ws-1',
          ownerId: 'owner-1',
          userId: 'owner-1',
          userIsMember: false,
        },
      ]),
    ).toEqual([]);
  });
});

describe('S28 : runSimulatedCalendarCleanup', () => {
  const makePrisma = () => {
    const tx = {
      timeBlock: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      integration: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      task: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      integration: { findMany: jest.fn().mockResolvedValue([]) },
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't-etranger',
            userId: 'etranger',
            project: { workspaceId: 'ws-1', workspace: { ownerId: 'owner-1' } },
            timeBlocks: [],
          },
          {
            id: 't-membre',
            userId: 'membre',
            project: { workspaceId: 'ws-1', workspace: { ownerId: 'owner-1' } },
            timeBlocks: [],
          },
        ]),
      },
      membership: {
        findMany: jest.fn().mockResolvedValue([{ workspaceId: 'ws-1', userId: 'membre' }]),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    return { prisma, tx };
  };

  it('mode rapport : la réattribution est planifiée mais rien n’est écrit', async () => {
    const { prisma, tx } = makePrisma();
    const result = await runSimulatedCalendarCleanup(prisma as unknown as PrismaClient, {
      apply: false,
    });
    expect(result.reassignments).toEqual([
      { taskId: 't-etranger', workspaceId: 'ws-1', oldUserId: 'etranger', newUserId: 'owner-1' },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it('--apply : réattribution conditionnelle (ancien propriétaire) dans la transaction', async () => {
    const { prisma, tx } = makePrisma();
    await runSimulatedCalendarCleanup(prisma as unknown as PrismaClient, { apply: true });
    expect(tx.task.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { id: 't-etranger', userId: 'etranger' },
      data: { userId: 'owner-1' },
    });
  });
});

describe('S28 : export CSV', () => {
  it('échappe les guillemets et neutralise les formules (injection CSV)', () => {
    const csv = toCsv(['email', 'note'], [['=HYPERLINK("x")', 'a,"b"']]);
    expect(csv).toBe('email,note\n"\'=HYPERLINK(""x"")","a,""b"""\n');
  });
});
