import {
  ACCOUNT_FAILURES_PER_MINUTE,
  AccountLockout,
  LOCKOUT_BASE_SECONDS,
  LOCKOUT_MAX_SECONDS,
  LOCKOUT_THRESHOLD,
  lockoutSeconds,
} from '../../../src/auth/account-lockout';
import { FakeRedisService } from '../../http/fake-redis';

/** S24 : limite des échecs d'authentification par compte, verrouillage progressif. */
describe('S24 : AccountLockout', () => {
  /** Tentatives réelles : réservation puis échec (comme `AuthService.login`). */
  const failTimes = async (lockout: AccountLockout, subject: string, times: number) => {
    for (let i = 0; i < times; i++) {
      await lockout.assertAllowed(subject).catch(() => undefined);
      await lockout.recordFailure(subject);
    }
  };
  /** Échecs seuls (sans réservation) : pour monter le compteur de 24 h sans la limite de la minute. */
  const recordOnly = async (lockout: AccountLockout, subject: string, times: number) => {
    for (let i = 0; i < times; i++) await lockout.recordFailure(subject);
  };
  const denied = async (lockout: AccountLockout, subject: string) =>
    lockout.assertAllowed(subject).then(
      () => null,
      (error) => error.getStatus(),
    );

  it('refuse (429) à partir du 6e essai en une minute, pour ce compte seulement', async () => {
    const lockout = new AccountLockout(new FakeRedisService(), 'login');
    for (let i = 0; i < ACCOUNT_FAILURES_PER_MINUTE; i++) {
      expect(await denied(lockout, 'a@x.com')).toBeNull();
      await lockout.recordFailure('a@x.com');
    }
    expect(await denied(lockout, 'a@x.com')).toBe(429);
    expect(await denied(lockout, 'b@x.com')).toBeNull();
  });

  it('la fenêtre d’une minute se vide', async () => {
    const redis = new FakeRedisService();
    const lockout = new AccountLockout(redis, 'login');
    await failTimes(lockout, 'a@x.com', ACCOUNT_FAILURES_PER_MINUTE);
    expect(await denied(lockout, 'a@x.com')).toBe(429);
    redis.advance(61_000);
    expect(await denied(lockout, 'a@x.com')).toBeNull();
  });

  it('réservation atomique : 30 tentatives simultanées, 5 seulement passent (r44-m2)', async () => {
    const lockout = new AccountLockout(new FakeRedisService(), 'login');
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        lockout.assertAllowed('a@x.com').then(
          () => 'passe',
          () => 'refus',
        ),
      ),
    );
    expect(results.filter((r) => r === 'passe')).toHaveLength(ACCOUNT_FAILURES_PER_MINUTE);
  });

  it('chaque pose de verrou est journalisée (empreinte seulement, jamais l’identité)', async () => {
    const lockout = new AccountLockout(new FakeRedisService(), 'login');
    const warn = jest
      .spyOn((lockout as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    await recordOnly(lockout, 'victime@corp.com', LOCKOUT_THRESHOLD - 1);
    expect(warn).not.toHaveBeenCalled();
    await recordOnly(lockout, 'victime@corp.com', 1);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0];
    expect(message).toContain('Verrouillage de compte posé (login)');
    expect(message).not.toContain('victime');
    expect(message).toMatch(/empreinte [0-9a-f]{12}/);
    await recordOnly(lockout, 'victime@corp.com', LOCKOUT_THRESHOLD);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('un succès remet les compteurs à zéro', async () => {
    const lockout = new AccountLockout(new FakeRedisService(), 'login');
    await failTimes(lockout, 'a@x.com', ACCOUNT_FAILURES_PER_MINUTE);
    await lockout.reset('a@x.com');
    expect(await denied(lockout, 'a@x.com')).toBeNull();
  });

  it('les portées login et mfa sont indépendantes pour un même identifiant', async () => {
    const redis = new FakeRedisService();
    const login = new AccountLockout(redis, 'login');
    const mfa = new AccountLockout(redis, 'mfa');
    await failTimes(login, 'u1', ACCOUNT_FAILURES_PER_MINUTE);
    expect(await denied(login, 'u1')).toBe(429);
    expect(await denied(mfa, 'u1')).toBeNull();
  });

  it('les clés Redis ne contiennent ni l’adresse e-mail ni l’identifiant en clair', async () => {
    const redis = new FakeRedisService();
    await new AccountLockout(redis, 'login').recordFailure('victime@corp.com');
    for (const key of redis.store.keys()) expect(key).not.toContain('victime');
    expect(redis.store.size).toBeGreaterThan(0);
  });

  describe('verrouillage progressif', () => {
    it('durées : 15 min au 10e échec, puis 30 min, 1 h... plafonné à 24 h', () => {
      expect(lockoutSeconds(LOCKOUT_THRESHOLD)).toBe(LOCKOUT_BASE_SECONDS);
      expect(lockoutSeconds(2 * LOCKOUT_THRESHOLD)).toBe(2 * LOCKOUT_BASE_SECONDS);
      expect(lockoutSeconds(3 * LOCKOUT_THRESHOLD)).toBe(4 * LOCKOUT_BASE_SECONDS);
      expect(lockoutSeconds(100 * LOCKOUT_THRESHOLD)).toBe(LOCKOUT_MAX_SECONDS);
    });

    it('au 10e échec cumulé le compte est verrouillé même après la fenêtre d’une minute', async () => {
      const redis = new FakeRedisService();
      const lockout = new AccountLockout(redis, 'login');
      await recordOnly(lockout, 'a@x.com', LOCKOUT_THRESHOLD - 1);
      redis.advance(61_000); // la limite de la minute est retombée
      expect(await denied(lockout, 'a@x.com')).toBeNull();
      await lockout.recordFailure('a@x.com'); // 10e échec
      redis.advance(61_000);
      expect(await denied(lockout, 'a@x.com')).toBe(429);
      // Le verrou tombe après 15 minutes
      redis.advance(LOCKOUT_BASE_SECONDS * 1000 + 1000);
      expect(await denied(lockout, 'a@x.com')).toBeNull();
    });

    it('au 20e échec le verrou dure le double', async () => {
      const redis = new FakeRedisService();
      const lockout = new AccountLockout(redis, 'login');
      await recordOnly(lockout, 'a@x.com', 2 * LOCKOUT_THRESHOLD);
      redis.advance(LOCKOUT_BASE_SECONDS * 1000 + 1000);
      expect(await denied(lockout, 'a@x.com')).toBe(429); // 15 min ne suffisent plus
      redis.advance(LOCKOUT_BASE_SECONDS * 1000);
      expect(await denied(lockout, 'a@x.com')).toBeNull();
    });
  });

  describe('Redis indisponible', () => {
    it('erreur : le compteur local de l’instance prend le relais (limite toujours appliquée)', async () => {
      const redis = new FakeRedisService();
      redis.mode = 'reject';
      const lockout = new AccountLockout(redis, 'login');
      await failTimes(lockout, 'a@x.com', ACCOUNT_FAILURES_PER_MINUTE);
      expect(await denied(lockout, 'a@x.com')).toBe(429);
      expect(await denied(lockout, 'b@x.com')).toBeNull();
    });

    it('commande qui ne répond pas : repli après le délai, puis plus aucune attente pendant la panne', async () => {
      const redis = new FakeRedisService();
      redis.mode = 'hang';
      const lockout = new AccountLockout(redis, 'login', 50);
      const started = Date.now();
      await lockout.assertAllowed('a@x.com'); // premier délai dépassé
      const afterFirst = Date.now() - started;
      await lockout.recordFailure('a@x.com');
      await lockout.assertAllowed('a@x.com');
      await lockout.reset('a@x.com');
      expect(afterFirst).toBeLessThan(1000);
      expect(Date.now() - started - afterFirst).toBeLessThan(40); // plus de nouveau délai
    });

    it('un magasin incomplet (TypeError) est traité comme une panne : pas d’exception', async () => {
      const lockout = new AccountLockout({} as never, 'login');
      await expect(lockout.assertAllowed('a@x.com')).resolves.toBeUndefined();
      await expect(lockout.recordFailure('a@x.com')).resolves.toBeUndefined();
    });
  });
});
