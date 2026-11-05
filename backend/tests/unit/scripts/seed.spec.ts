import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import type { Auth } from 'firebase-admin/auth';

const mariaDb = jest.fn();
const getAuthMock = jest.fn();
jest.mock('@prisma/adapter-mariadb', () => ({ PrismaMariaDb: mariaDb }));
jest.mock('firebase-admin/auth', () => ({ getAuth: getAuthMock }));
const mockPrismaClient = jest.fn();
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  PrismaClient: mockPrismaClient,
}));

import { main, resolveSeedConfig, runSeed } from '../../../prisma/seed';

// Valeurs publiées dans l'historique Git, assemblées ici pour ne pas les écrire en clair
const PUBLISHED = ['Admin123' + '!Secure', 'Manager123' + '!Secure', 'User123' + '!Secure'];

const GOOD = {
  SEED_ADMIN_PASSWORD: 'correct-horse-battery-1',
  SEED_MANAGER_PASSWORD: 'staple-purple-monkey-22',
  SEED_USER_PASSWORD: 'dishwasher-orange-33x',
};
const baseEnv = { NODE_ENV: 'development', DATABASE_URL: 'mysql://u:p@localhost:3306/db', ...GOOD };

type Row = Record<string, unknown>;

function fakePrisma(initial: Row[] = [], initialMemberships: Row[] = []) {
  const users: Row[] = [...initial];
  const memberships: Row[] = [...initialMemberships];
  const userApi = {
    findUnique: jest.fn(
      async ({ where }: { where: { email: string } }) =>
        users.find((u) => u.email === where.email) ?? null,
    ),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const row = { id: `u${users.length + 1}`, ...data };
      users.push(row);
      return row;
    }),
    update: jest.fn(),
    upsert: jest.fn(),
  };
  const prisma = {
    user: userApi,
    workspace: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'w1', name: 'W' })),
    },
    membership: {
      // même sémantique que Prisma : `update` appliqué à une ligne existante, sinon `create`
      upsert: jest.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { workspaceId_userId: Row };
          update: Row;
          create: Row;
        }) => {
          const key = where.workspaceId_userId;
          const row = memberships.find((m) => m.userId === key.userId);
          if (row) return Object.assign(row, update);
          memberships.push({ ...create });
          return create;
        },
      ),
    },
    project: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'p1', name: 'P' })),
    },
    projectMembership: { upsert: jest.fn() },
    task: { count: jest.fn(async () => 1), create: jest.fn() },
    comment: { create: jest.fn() },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    userApi,
    users,
    memberships,
    mocks: prisma,
  };
}

const printedBy = (spies: jest.SpyInstance[]) =>
  spies
    .flatMap((spy) =>
      spy.mock.calls.map((args: unknown[]) =>
        args.map((a: unknown) => inspect(a, { depth: 6 })).join(' '),
      ),
    )
    .join('\n');

const config = (extra: Record<string, string> = {}) => resolveSeedConfig({ ...baseEnv, ...extra });

describe('S30 : seed sans secret par défaut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('SEED_ADMIN_PASSWORD absent : arrêt avant toute écriture (ni base ni Firebase)', async () => {
    const env: Record<string, string | undefined> = { ...baseEnv };
    delete env.SEED_ADMIN_PASSWORD;
    await expect(main(env)).rejects.toThrow(/SEED_ADMIN_PASSWORD/);
    expect(mariaDb).not.toHaveBeenCalled();
    expect(getAuthMock).not.toHaveBeenCalled();
  });

  it('NODE_ENV absent : refus', async () => {
    const env: Record<string, string | undefined> = { ...baseEnv };
    delete env.NODE_ENV;
    await expect(main(env)).rejects.toThrow(/NODE_ENV/);
    expect(mariaDb).not.toHaveBeenCalled();
  });

  it('production sans SEED_ALLOW_PRODUCTION : refus ; avec le drapeau : aucun platformRole', async () => {
    await expect(main({ ...baseEnv, NODE_ENV: 'production' })).rejects.toThrow(
      /SEED_ALLOW_PRODUCTION/,
    );
    expect(mariaDb).not.toHaveBeenCalled();

    const cfg = config({ NODE_ENV: 'production', SEED_ALLOW_PRODUCTION: 'true' });
    expect(cfg.production).toBe(true);
    expect(cfg.firebaseSync).toBe(false);
    const { prisma, userApi } = fakePrisma();
    await runSeed(prisma, null, cfg);
    expect(userApi.create).toHaveBeenCalledTimes(3);
    for (const [{ data }] of userApi.create.mock.calls) {
      expect(data).not.toHaveProperty('platformRole');
    }
  });

  it('hors production, seul le compte admin reçoit SUPER_ADMIN à la création', async () => {
    const { prisma, userApi } = fakePrisma();
    await runSeed(prisma, null, config());
    const roles = userApi.create.mock.calls.map(([{ data }]) => data.platformRole);
    expect(roles).toEqual(['SUPER_ADMIN', undefined, undefined]);
  });

  it.each(PUBLISHED)('refuse la valeur publiée %s', (published) => {
    expect(() => config({ SEED_ADMIN_PASSWORD: published })).toThrow(/publiée/);
    expect(() => config({ SEED_USER_PASSWORD: published })).toThrow(/publiée/);
  });

  it('refuse un mot de passe de moins de 16 caractères ou répété', () => {
    expect(() => config({ SEED_MANAGER_PASSWORD: 'short-1234567' })).toThrow(/16 caractères/);
    expect(() => config({ SEED_USER_PASSWORD: GOOD.SEED_ADMIN_PASSWORD })).toThrow(/différents/);
  });

  it('compte existant suspendu et sans rôle : ni promu, ni réactivé, ni réinitialisé', async () => {
    const existing = {
      id: 'x',
      email: 'admin@planner-pro.com',
      platformRole: null,
      isSuspended: true,
      passwordHash: 'ancien-hash',
      firebaseUid: null,
    };
    const before = structuredClone(existing);
    const { prisma, userApi, users } = fakePrisma([existing]);
    await runSeed(prisma, null, config());
    // copie profonde prise AVANT l'exécution : détecte aussi une modification en place
    expect(users[0]).toEqual(before);
    expect(userApi.update).not.toHaveBeenCalled();
    expect(userApi.upsert).not.toHaveBeenCalled();
  });

  it('compte Firebase existant : ni updateUser, ni mot de passe modifié, pas de rattachement', async () => {
    const auth = {
      getUserByEmail: jest.fn(async () => ({ uid: 'uid-existant' })),
      updateUser: jest.fn(),
      createUser: jest.fn(),
    };
    const { prisma, userApi } = fakePrisma();
    await runSeed(prisma, auth as unknown as Auth, config());
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.createUser).not.toHaveBeenCalled();
    for (const [{ data }] of userApi.create.mock.calls) {
      expect(data).not.toHaveProperty('firebaseUid');
    }
  });

  it('aucun appel console.* ne contient un mot de passe du seed', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    const auth = {
      getUserByEmail: jest.fn(async () => {
        throw Object.assign(new Error(`échec ${GOOD.SEED_ADMIN_PASSWORD}`), {
          code: 'auth/user-not-found',
        });
      }),
      createUser: jest.fn(async (u: { email: string }) => {
        if (u.email.startsWith('user@')) throw new Error(`boom ${GOOD.SEED_USER_PASSWORD}`);
        return { uid: `uid-${u.email}` };
      }),
    };
    const { prisma } = fakePrisma();
    await runSeed(prisma, auth as unknown as Auth, config());
    // util.inspect : un `console.warn(err)` dont le message contient le secret serait détecté
    const printed = printedBy(spies);
    for (const secret of Object.values(GOOD)) expect(printed).not.toContain(secret);
    expect(printed).toContain('admin@planner-pro.com');
  });

  it('seed.ts ne contient plus les trois valeurs publiées ni de DSN par défaut', () => {
    const source = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf8');
    for (const published of PUBLISHED) expect(source).not.toContain(published);
    expect(source).not.toContain('root_password');
    expect(source).not.toMatch(/SEED_\w+_PASSWORD\s*\|\|/);
  });

  it("main() en production (SEED_ALLOW_PRODUCTION=true) : l'avertissement ne contient aucun mot de passe", async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { prisma, userApi } = fakePrisma();
    mockPrismaClient.mockImplementation(() => ({
      ...(prisma as unknown as Row),
      $disconnect: jest.fn(),
    }));

    await main({
      ...baseEnv,
      NODE_ENV: 'production',
      SEED_ALLOW_PRODUCTION: 'true',
    });

    expect(spies[2]).toHaveBeenCalled(); // l'avertissement de production a bien été émis
    const printed = printedBy(spies);
    for (const secret of Object.values(GOOD)) expect(printed).not.toContain(secret);
    expect(userApi.create).toHaveBeenCalledTimes(3);
    expect(getAuthMock).not.toHaveBeenCalled();
  });

  it('adhésions existantes : jamais restaurées par une réexécution (aucun upsert avec update non vide)', async () => {
    const existing = [
      { userId: 'u1', role: 'VIEWER' },
      { userId: 'u2', role: 'VIEWER' },
    ];
    const { prisma, mocks, memberships } = fakePrisma(
      [
        { id: 'u1', email: 'admin@planner-pro.com' },
        { id: 'u2', email: 'manager@planner-pro.com' },
        { id: 'u3', email: 'user@planner-pro.com' },
      ],
      structuredClone(existing),
    );
    await runSeed(prisma, null, config());
    expect(memberships.slice(0, 2)).toEqual(existing); // toujours VIEWER
    const upserts = [
      ...mocks.membership.upsert.mock.calls,
      ...mocks.projectMembership.upsert.mock.calls,
    ];
    expect(upserts.length).toBeGreaterThan(0);
    for (const [args] of upserts) expect((args as { update: Row }).update).toEqual({});
  });

  it("compte MySQL existant : aucun compte Firebase n'est (re)créé pour lui", async () => {
    const auth = {
      getUserByEmail: jest.fn(async () => {
        throw Object.assign(new Error('absent'), { code: 'auth/user-not-found' });
      }),
      createUser: jest.fn(async (u: { email: string }) => ({ uid: `uid-${u.email}` })),
      updateUser: jest.fn(),
    };
    const { prisma, userApi } = fakePrisma([
      { id: 'u1', email: 'admin@planner-pro.com' },
      { id: 'u2', email: 'manager@planner-pro.com' },
    ]);
    await runSeed(prisma, auth as unknown as Auth, config());
    // seul `user@` est créé en base : seul son compte Firebase est créé
    expect(userApi.create).toHaveBeenCalledTimes(1);
    expect(auth.createUser).toHaveBeenCalledTimes(1);
    expect(auth.createUser.mock.calls[0][0].email).toBe('user@planner-pro.com');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
