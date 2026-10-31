import { UnverifiedAccountPurgeService } from '../../../src/auth/unverified-account-purge.service';

/** P6-c : une inscription jamais vérifiée ne bloque pas l'adresse au-delà de 7 jours. */
describe('P6-c : purge des inscriptions non vérifiées', () => {
  const NOW = new Date('2026-11-20T03:30:00Z');

  const build = (opts: {
    candidates?: Array<{ id: string }>;
    memberships?: Array<{ workspaceId: string }>;
    owned?: Array<{ id: string }>;
    otherMembers?: number;
    deleteFails?: boolean;
  }) => {
    const tx = {
      membership: {
        findMany: jest.fn().mockResolvedValue(opts.memberships ?? [{ workspaceId: 'w1' }]),
        count: jest.fn().mockResolvedValue(opts.otherMembers ?? 0),
      },
      workspace: {
        findMany: jest.fn().mockResolvedValue(opts.owned ?? [{ id: 'w1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        delete: opts.deleteFails
          ? jest.fn().mockRejectedValue(new Error('FK'))
          : jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue(opts.candidates ?? [{ id: 'u1' }]) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<boolean>) => fn(tx)),
    };
    return { prisma, tx, service: new UnverifiedAccountPurgeService(prisma as never) };
  };

  it('ne cible que les comptes par mot de passe, non vérifiés, de plus de 7 jours, sans autre identité', async () => {
    const { prisma, service } = build({});
    await service.purge(NOW);
    const call = prisma.user.findMany.mock.calls[0][0];
    const where = call.where;
    expect(call.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(where).toMatchObject({
      emailVerifiedAt: null,
      passwordHash: { not: null },
      firebaseUid: null,
      githubId: null,
      ssoUid: null,
      provisionedByWorkspaceId: null,
    });
    expect(where.createdAt.lt).toEqual(new Date(NOW.getTime() - 7 * 24 * 3600 * 1000));
  });

  it('supprime l’espace d’onboarding personnel puis le compte', async () => {
    const { tx, service } = build({});
    expect(await service.purge(NOW)).toBe(1);
    expect(tx.workspace.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['w1'] } } });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('conserve un compte membre d’un autre espace ou dont l’espace a d’autres membres', async () => {
    const foreign = build({ memberships: [{ workspaceId: 'w1' }, { workspaceId: 'autre' }] });
    expect(await foreign.service.purge(NOW)).toBe(0);
    expect(foreign.tx.user.delete).not.toHaveBeenCalled();

    const shared = build({ otherMembers: 2 });
    expect(await shared.service.purge(NOW)).toBe(0);
    expect(shared.tx.workspace.deleteMany).not.toHaveBeenCalled();
  });

  it('curseur : un lot plein est suivi du lot suivant (les comptes conservés ne bloquent pas la purge)', async () => {
    const batch = (from: number) =>
      Array.from({ length: 200 }, (_, i) => ({
        id: `u${from + i}`,
        createdAt: new Date(2026, 0, 1, 0, 0, from + i),
      }));
    const { prisma, tx, service } = build({ memberships: [{ workspaceId: 'autre' }] });
    prisma.user.findMany
      .mockResolvedValueOnce(batch(0))
      .mockResolvedValueOnce([{ id: 'dernier', createdAt: new Date(2026, 1, 1) }]);

    await service.purge(NOW);

    expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
    const second = prisma.user.findMany.mock.calls[1][0].where;
    expect(second.AND[1].OR[0].createdAt.gt).toEqual(batch(0)[199].createdAt);
    expect(second.AND[1].OR[1].id.gt).toBe('u199');
    expect(tx.membership.findMany).toHaveBeenCalledTimes(201); // les 201 comptes ont été examinés
  });

  it('une contrainte inattendue n’interrompt pas la purge', async () => {
    const { service } = build({ deleteFails: true, candidates: [{ id: 'u1' }, { id: 'u2' }] });
    await expect(service.purge(NOW)).resolves.toBe(0);
  });
});
