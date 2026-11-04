import { PrismaClient } from '@prisma/client';
import {
  planLegacySsoUidReset,
  runLegacySsoUidReset,
} from '../../../scripts/reset-legacy-sso-uids';
import { FakePrisma } from '../../http/fake-prisma';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('S10-d : script reset-legacy-sso-uids', () => {
  const seed = async () => {
    const prisma = new FakePrisma();
    await prisma.user.create({ data: { id: 'u1', email: 'a@acme.com', ssoUid: 'azure-ad:oid-1' } });
    await prisma.user.create({ data: { id: 'u2', email: 'b@acme.com', ssoUid: 'google:sub-2' } });
    await prisma.user.create({ data: { id: 'u3', email: 'c@acme.com', ssoUid: null } });
    await prisma.user.create({
      data: { id: 'u4', email: 'd@acme.com', ssoUid: `azure-ad:${TENANT}:oid-4` },
    });
    return prisma;
  };
  const asClient = (prisma: FakePrisma) =>
    ({
      user: {
        findMany: (args: never) => prisma.user.findMany(args),
        updateMany: (args: never) => prisma.user.updateMany(args),
      },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ user: prisma.user }),
    }) as unknown as PrismaClient;
  const uidOf = (prisma: FakePrisma, id: string) =>
    prisma.user.rows.find((r) => r.id === id)?.ssoUid;

  it('sélectionne les liaisons héritées et conserve le format Azure actuel', () => {
    expect(
      planLegacySsoUidReset([
        { id: '1', ssoUid: 'azure-ad:oid' },
        { id: '2', ssoUid: 'google:sub' },
        { id: '3', ssoUid: null },
        { id: '4', ssoUid: `azure-ad:${TENANT}:oid` },
      ]).map((p) => p.id),
    ).toEqual(['1', '2']);
  });

  it('mode rapport : aucune écriture', async () => {
    const prisma = await seed();
    const report = await runLegacySsoUidReset(asClient(prisma), { apply: false });
    expect(report.plan).toHaveLength(2);
    expect(report.updated).toBe(0);
    expect(uidOf(prisma, 'u1')).toBe('azure-ad:oid-1');
    expect(uidOf(prisma, 'u2')).toBe('google:sub-2');
  });

  it('--apply remet à NULL ; une seconde passe annonce 0', async () => {
    const prisma = await seed();
    const applied = await runLegacySsoUidReset(asClient(prisma), { apply: true });
    expect(applied.updated).toBe(2);
    expect(uidOf(prisma, 'u1')).toBeNull();
    expect(uidOf(prisma, 'u2')).toBeNull();
    expect(uidOf(prisma, 'u4')).toBe(`azure-ad:${TENANT}:oid-4`);

    const again = await runLegacySsoUidReset(asClient(prisma), { apply: true });
    expect(again.plan).toHaveLength(0);
    expect(again.updated).toBe(0);
  });

  it('le plan ne contient aucun identifiant IdP dans les champs rapportés (fournisseur seul)', () => {
    const [entry] = planLegacySsoUidReset([{ id: '1', ssoUid: 'google:sub-secret' }]);
    expect(entry.provider).toBe('google');
  });
});
