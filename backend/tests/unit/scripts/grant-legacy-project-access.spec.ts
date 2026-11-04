/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  GRANT_CSV_HEADERS,
  grantsToCsvRows,
  planLegacyGrants,
  runLegacyProjectAccessGrant,
} from '../../../scripts/grant-legacy-project-access';
import { writeCsvReport } from '../../../scripts/lib/csv';

type Row = Record<string, unknown>;

/**
 * Évalue un `where` Prisma reçu (égalité à null, `in`, relation `workspace`) : le faux Prisma ne
 * refait pas les filtres du script, il applique ceux que le script lui envoie. Un filtre retiré
 * du script change donc les lignes renvoyées. Un opérateur inconnu fait échouer le test.
 */
function matches(row: Row | undefined, where: Row, workspaces: Row[]): boolean {
  if (!row) return false;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'workspace') {
      const ws = workspaces.find((w) => w.id === row.workspaceId);
      return matches(ws, cond as Row, workspaces);
    }
    if (cond === null) return row[key] === null;
    if (cond && typeof cond === 'object' && 'in' in cond) {
      return (cond as { in: unknown[] }).in.includes(row[key]);
    }
    throw new Error(`Filtre non géré par le faux Prisma : ${key}`);
  });
}

/** Prisma simulé : évalue les `where` reçus sur des données qui contiennent aussi les cas à exclure. */
function buildFakePrisma() {
  const data = {
    workspaces: [
      { id: 'W1', deletedAt: null },
      { id: 'W2', deletedAt: new Date() }, // workspace supprimé
    ] as Row[],
    memberships: [
      { workspaceId: 'W1', userId: 'owner', role: 'OWNER' },
      { workspaceId: 'W1', userId: 'admin', role: 'ADMIN' },
      { workspaceId: 'W1', userId: 'member', role: 'MEMBER' },
      { workspaceId: 'W1', userId: 'viewer', role: 'VIEWER' },
      { workspaceId: 'W1', userId: 'already', role: 'MEMBER' }, // a déjà un rôle sur P1
      { workspaceId: 'W2', userId: 'ghost', role: 'MEMBER' },
      // 'deprov' n'a plus de Membership (désactivé par SCIM) : absent de la liste
    ] as Row[],
    projects: [
      { id: 'P1', workspaceId: 'W1', userId: 'member', deletedAt: null }, // créé par 'member'
      { id: 'P2', workspaceId: 'W1', userId: 'owner', deletedAt: null },
      { id: 'P-del', workspaceId: 'W1', userId: 'owner', deletedAt: new Date() },
      { id: 'P-perso', workspaceId: null, userId: 'owner', deletedAt: null },
      { id: 'P-w2', workspaceId: 'W2', userId: 'owner', deletedAt: null },
    ] as Row[],
    projectMemberships: [
      { projectId: 'P1', userId: 'already', role: 'COMMENTER' },
      { projectId: 'P1', userId: 'deprov', role: 'CONTRIBUTOR' },
    ] as Row[],
  };
  const createMany = jest.fn(async ({ data: rows }: { data: Row[] }) => {
    let count = 0;
    for (const r of rows) {
      if (data.projectMemberships.some((e) => e.projectId === r.projectId && e.userId === r.userId))
        continue;
      data.projectMemberships.push(r);
      count++;
    }
    return { count };
  });
  const client: Record<string, unknown> = {
    membership: {
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        data.memberships.filter((m) => matches(m, where, data.workspaces)),
      ),
    },
    project: {
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        data.projects.filter((p) => matches(p, where, data.workspaces)),
      ),
    },
    projectMembership: {
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        data.projectMemberships.filter((e) => matches(e, where, data.workspaces)),
      ),
      createMany,
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  return { data, client: client as unknown as PrismaClient, createMany, raw: client as any };
}

const roleOf = (data: ReturnType<typeof buildFakePrisma>['data'], p: string, u: string) =>
  data.projectMemberships.find((e) => e.projectId === p && e.userId === u)?.role;

describe('P4 : script grant-legacy-project-access', () => {
  it('mode rapport : liste les accès à accorder et n’écrit rien', async () => {
    const { data, client, createMany } = buildFakePrisma();
    const before = data.projectMemberships.length;
    const { grants, created } = await runLegacyProjectAccessGrant(client, { apply: false });
    expect(created).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
    expect(data.projectMemberships).toHaveLength(before);
    // viewer sur P1 et P2, member sur P2 seulement (il a créé P1), already sur P2 seulement
    expect(grants.map((g) => `${g.projectId}:${g.userId}:${g.projectRole}`).sort()).toEqual([
      'P1:viewer:CLIENT',
      'P2:already:CONTRIBUTOR',
      'P2:member:CONTRIBUTOR',
      'P2:viewer:CLIENT',
    ]);
  });

  it('--apply : MEMBER devient CONTRIBUTOR, VIEWER devient CLIENT ; rôles existants intacts', async () => {
    const { data, client } = buildFakePrisma();
    const { created } = await runLegacyProjectAccessGrant(client, { apply: true });
    expect(created).toBe(4);
    expect(roleOf(data, 'P2', 'member')).toBe('CONTRIBUTOR');
    expect(roleOf(data, 'P2', 'viewer')).toBe('CLIENT');
    expect(roleOf(data, 'P1', 'already')).toBe('COMMENTER');
    expect(roleOf(data, 'P2', 'already')).toBe('CONTRIBUTOR');
  });

  it('ignore OWNER/ADMIN, les comptes sans Membership, les projets supprimés, personnels et de workspaces supprimés', async () => {
    const { data, client } = buildFakePrisma();
    await runLegacyProjectAccessGrant(client, { apply: true });
    const touched = (u: string) => data.projectMemberships.filter((e) => e.userId === u);
    expect(touched('owner')).toHaveLength(0);
    expect(touched('admin')).toHaveLength(0);
    expect(touched('ghost')).toHaveLength(0);
    expect(touched('deprov')).toHaveLength(1); // son accès d'origine, inchangé
    for (const id of ['P-del', 'P-perso', 'P-w2']) {
      expect(data.projectMemberships.some((e) => e.projectId === id)).toBe(false);
    }
  });

  it('le créateur d’un projet n’est pas concerné (aligné sur la requête SQL du runbook § 2)', async () => {
    const { data, client } = buildFakePrisma();
    await runLegacyProjectAccessGrant(client, { apply: true });
    expect(roleOf(data, 'P1', 'member')).toBeUndefined();
    expect(roleOf(data, 'P2', 'member')).toBe('CONTRIBUTOR');
  });

  it('les requêtes envoyées à Prisma portent les filtres d’exclusion', async () => {
    const { raw, client } = buildFakePrisma();
    await runLegacyProjectAccessGrant(client, { apply: false });
    expect(raw.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { in: ['MEMBER', 'VIEWER'] }, workspace: { deletedAt: null } },
      }),
    );
    expect(raw.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: { in: ['W1'] }, deletedAt: null },
        select: expect.objectContaining({ userId: true }),
      }),
    );
  });

  it('--apply : transaction avec un délai allongé', async () => {
    const { raw, client } = buildFakePrisma();
    await runLegacyProjectAccessGrant(client, { apply: true });
    expect(raw.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 120_000 });
  });

  it('calcul pur : OWNER et ADMIN ne reçoivent aucun accès, même fournis en entrée', () => {
    const grants = planLegacyGrants(
      [
        { workspaceId: 'W', userId: 'o', role: 'OWNER' },
        { workspaceId: 'W', userId: 'a', role: 'ADMIN' },
      ],
      [{ id: 'P', workspaceId: 'W' }],
      [],
    );
    expect(grants).toEqual([]);
  });

  it('calcul pur : le créateur du projet est ignoré', () => {
    const grants = planLegacyGrants(
      [
        { workspaceId: 'W', userId: 'c', role: 'MEMBER' },
        { workspaceId: 'W', userId: 'x', role: 'MEMBER' },
      ],
      [{ id: 'P', workspaceId: 'W', userId: 'c' }],
      [],
    );
    expect(grants.map((g) => g.userId)).toEqual(['x']);
  });

  it('idempotent : une seconde exécution ne trouve plus rien', async () => {
    const { data, client } = buildFakePrisma();
    await runLegacyProjectAccessGrant(client, { apply: true });
    const after = data.projectMemberships.length;
    const second = await runLegacyProjectAccessGrant(client, { apply: true });
    expect(second.grants).toEqual([]);
    expect(second.created).toBe(0);
    expect(data.projectMemberships).toHaveLength(after);
  });

  it('le calcul pur ne produit aucun doublon', () => {
    const grants = planLegacyGrants(
      [
        { workspaceId: 'W', userId: 'u', role: 'MEMBER' },
        { workspaceId: 'W', userId: 'u', role: 'MEMBER' },
      ],
      [{ id: 'P', workspaceId: 'W' }],
      [],
    );
    expect(grants).toHaveLength(1);
  });

  it('CSV : identifiants seulement, aucune adresse e-mail', async () => {
    const { client } = buildFakePrisma();
    const { grants } = await runLegacyProjectAccessGrant(client, { apply: false });
    const path = join(mkdtempSync(join(tmpdir(), 'p4-')), 'rapport.csv');
    writeCsvReport(path, GRANT_CSV_HEADERS, grantsToCsvRows(grants, 'RAPPORT'));
    const csv = readFileSync(path, 'utf8');
    expect(csv).not.toMatch(/@/);
    expect(csv).not.toMatch(/email/i);
    expect(csv.split('\n').filter(Boolean)).toHaveLength(1 + grants.length);
  });
});
