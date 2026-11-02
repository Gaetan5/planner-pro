import { PrismaClient } from '@prisma/client';
import { decrypt, encrypt } from '../../../src/auth/encryption.util';
import {
  planSsoSecretEncryption,
  runSsoSecretEncryption,
} from '../../../scripts/encrypt-sso-secrets';
import { FakePrisma } from '../../http/fake-prisma';

describe('S10 : script encrypt-sso-secrets', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
  });

  const seed = async () => {
    const prisma = new FakePrisma();
    await prisma.sSOConfiguration.create({
      data: { id: 'c1', domain: 'a.com', clientSecret: 'secret-clair' },
    });
    await prisma.sSOConfiguration.create({
      data: { id: 'c2', domain: 'b.com', clientSecret: encrypt('deja') },
    });
    await prisma.sSOConfiguration.create({
      data: { id: 'c3', domain: 'c.com', clientSecret: null },
    });
    return prisma;
  };
  const asClient = (prisma: FakePrisma) =>
    ({
      sSOConfiguration: {
        findMany: async () => prisma.sSOConfiguration.rows.filter((r) => r.clientSecret !== null),
        updateMany: (args: never) => prisma.sSOConfiguration.updateMany(args),
      },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ sSOConfiguration: prisma.sSOConfiguration }),
    }) as unknown as PrismaClient;

  it('ne sélectionne que les secrets en clair', () => {
    expect(
      planSsoSecretEncryption([
        { id: '1', domain: 'a.com', clientSecret: 'clair' },
        { id: '2', domain: 'b.com', clientSecret: encrypt('x') },
        { id: '3', domain: 'c.com', clientSecret: null },
      ]).map((p) => p.id),
    ).toEqual(['1']);
  });

  it('rapport seul : aucune écriture ; --apply : chiffré et idempotent', async () => {
    const prisma = await seed();
    const report = await runSsoSecretEncryption(asClient(prisma), { apply: false });
    expect(report.plan).toHaveLength(1);
    expect(prisma.sSOConfiguration.rows[0].clientSecret).toBe('secret-clair');

    const applied = await runSsoSecretEncryption(asClient(prisma), { apply: true });
    expect(applied.updated).toBe(1);
    expect(decrypt(prisma.sSOConfiguration.rows[0].clientSecret as string)).toBe('secret-clair');

    const again = await runSsoSecretEncryption(asClient(prisma), { apply: true });
    expect(again.plan).toHaveLength(0);
    expect(again.updated).toBe(0);
  });
});
