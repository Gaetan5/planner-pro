import { PrismaClient } from '@prisma/client';
import { decrypt, encrypt } from '../../../src/auth/encryption.util';
import {
  planMfaSecretEncryption,
  runMfaSecretEncryption,
} from '../../../scripts/encrypt-mfa-secrets';
import { FakePrisma } from '../../http/fake-prisma';

describe('S6 : script encrypt-mfa-secrets', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
  });

  const seed = async () => {
    const prisma = new FakePrisma();
    await prisma.user.create({
      data: { id: 'u-clair', email: 'a@x.com', mfaSecret: 'JBSWY3DPEHPK3PXP', mfaEnabled: true },
    });
    await prisma.user.create({
      data: { id: 'u-chiffre', email: 'b@x.com', mfaSecret: encrypt('KRSXG5CTMVRXEZLU') },
    });
    await prisma.user.create({
      data: { id: 'u-attente', email: 'c@x.com', mfaPendingSecret: 'MFRGGZDFMZTWQ2LK' },
    });
    await prisma.user.create({ data: { id: 'u-sans', email: 'd@x.com' } });
    return prisma;
  };
  // Le faux Prisma ne gère pas `{ not: null }` : on simule la sélection du script
  const asClient = (prisma: FakePrisma) =>
    ({
      user: {
        findMany: async () =>
          prisma.user.rows.filter((r) => r.mfaSecret !== null || r.mfaPendingSecret !== null),
        updateMany: (args: never) => prisma.user.updateMany(args),
      },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ user: prisma.user }),
    }) as unknown as PrismaClient;

  it('ne sélectionne que les secrets en clair, sans jamais les exposer dans le plan CSV', () => {
    const plan = planMfaSecretEncryption([
      { id: '1', email: 'a@x.com', mfaSecret: 'JBSWY3DPEHPK3PXP', mfaPendingSecret: null },
      { id: '2', email: 'b@x.com', mfaSecret: encrypt('K'), mfaPendingSecret: null },
      { id: '3', email: 'c@x.com', mfaSecret: null, mfaPendingSecret: 'MFRGGZDFMZTWQ2LK' },
    ]);
    expect(plan.map((p) => [p.userId, p.field])).toEqual([
      ['1', 'mfaSecret'],
      ['3', 'mfaPendingSecret'],
    ]);
  });

  it('mode rapport : aucune écriture', async () => {
    const prisma = await seed();
    const updateSpy = jest.spyOn(prisma.user, 'updateMany');
    const result = await runMfaSecretEncryption(asClient(prisma), { apply: false });
    expect(result.plan).toHaveLength(2);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(prisma.user.rows[0].mfaSecret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('--apply chiffre les secrets en clair, laisse les chiffrés, et reste déchiffrable', async () => {
    const prisma = await seed();
    const before = prisma.user.rows[1].mfaSecret;
    await runMfaSecretEncryption(asClient(prisma), { apply: true });

    expect(prisma.user.rows[0].mfaSecret).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(decrypt(prisma.user.rows[0].mfaSecret as string)).toBe('JBSWY3DPEHPK3PXP');
    expect(decrypt(prisma.user.rows[2].mfaPendingSecret as string)).toBe('MFRGGZDFMZTWQ2LK');
    expect(prisma.user.rows[1].mfaSecret).toBe(before);
  });

  it('idempotent : une seconde exécution ne modifie rien', async () => {
    const prisma = await seed();
    await runMfaSecretEncryption(asClient(prisma), { apply: true });
    const snapshot = JSON.stringify(prisma.user.rows);
    const second = await runMfaSecretEncryption(asClient(prisma), { apply: true });
    expect(second.plan).toHaveLength(0);
    expect(second.updated).toBe(0);
    expect(JSON.stringify(prisma.user.rows)).toBe(snapshot);
  });
});
