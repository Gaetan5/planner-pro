import { RedisService } from '../../../src/redis/redis.service';
import { RedisThrottlerStorage, WindowCounter } from '../../../src/common/redis-throttler.storage';
import { FakeRedisService } from '../../http/fake-redis';

const LIMIT = 60;

/** S24 : stockage du limiteur dans Redis, partagé entre instances, avec repli mémoire. */
describe('S24 : RedisThrottlerStorage', () => {
  it('deux instances partagent le même compteur (multi-instance)', async () => {
    const redis = new FakeRedisService();
    const a = new RedisThrottlerStorage(redis);
    const b = new RedisThrottlerStorage(redis);
    expect((await a.increment('k', 60000, LIMIT, 60000, 'default')).totalHits).toBe(1);
    expect((await b.increment('k', 60000, LIMIT, 60000, 'default')).totalHits).toBe(2);
    expect((await a.increment('k', 60000, LIMIT, 60000, 'default')).totalHits).toBe(3);
    expect((await b.increment('autre', 60000, LIMIT, 60000, 'default')).totalHits).toBe(1);
    // Clés préfixées : pas de collision avec le reste de Redis
    expect([...redis.store.keys()].every((key) => key.startsWith('throttle:'))).toBe(true);
  });

  it('timeToExpire est en secondes (Retry-After) et la fenêtre expire', async () => {
    const redis = new FakeRedisService();
    const storage = new RedisThrottlerStorage(redis);
    const first = await storage.increment('k', 60000, LIMIT, 60000, 'default');
    expect(first.timeToExpire).toBeGreaterThan(55);
    expect(first.timeToExpire).toBeLessThanOrEqual(60);
    redis.advance(61000);
    expect((await storage.increment('k', 60000, LIMIT, 60000, 'default')).totalHits).toBe(1);
  });

  it('Redis en erreur : repli sur un compteur local, jamais d’exception', async () => {
    const redis = new FakeRedisService();
    redis.mode = 'reject';
    const storage = new RedisThrottlerStorage(redis);
    expect((await storage.increment('k', 60000, LIMIT, 60000, 'default')).totalHits).toBe(1);
    expect((await storage.increment('k', 60000, LIMIT, 60000, 'default')).totalHits).toBe(2);
    storage.onApplicationShutdown();
  });

  it('Redis qui ne répond pas : repli après le délai', async () => {
    const redis = new FakeRedisService();
    redis.mode = 'hang';
    const storage = new RedisThrottlerStorage(redis, undefined, 50);
    const started = Date.now();
    expect((await storage.increment('k', 60000, LIMIT, 60000, 'default')).totalHits).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
    storage.onApplicationShutdown();
  });

  it('disjoncteur : 100 appels pendant une panne n’ajoutent pas 100 délais (r44-a2)', async () => {
    const redis = new FakeRedisService();
    redis.mode = 'hang';
    const storage = new RedisThrottlerStorage(redis, undefined, 100);
    const started = Date.now();
    for (let i = 0; i < 100; i++)
      await storage.increment(`k${i % 3}`, 60000, LIMIT, 60000, 'default');
    // un seul délai de 100 ms (sans disjoncteur : 100 × 100 ms = 10 s)
    expect(Date.now() - started).toBeLessThan(1500);
    storage.onApplicationShutdown();
  });

  it('une seule alerte par épisode de panne', async () => {
    const counter: WindowCounter = { incrementWindow: jest.fn().mockRejectedValue(new Error('x')) };
    const storage = new RedisThrottlerStorage(counter);
    const warn = jest
      .spyOn((storage as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    for (let i = 0; i < 5; i++) await storage.increment('k', 60000, LIMIT, 60000, 'default');
    expect(warn).toHaveBeenCalledTimes(1);
    storage.onApplicationShutdown();
  });

  describe('A9-b1 : le stockage décide du blocage (throttler 6)', () => {
    it('au limit-ième appel isBlocked est faux, au limit+1-ième il est vrai', async () => {
      const storage = new RedisThrottlerStorage(new FakeRedisService());
      const records = [];
      for (let i = 0; i < 4; i++)
        records.push(await storage.increment('k', 60000, 3, 60000, 'default'));
      expect(records.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
      expect(records.map((r) => r.isBlocked)).toEqual([false, false, false, true]);
    });

    it('timeToBlockExpire : 0 hors blocage, sinon le temps restant de la fenêtre (entier en secondes, ≥ 1)', async () => {
      const redis = new FakeRedisService();
      const storage = new RedisThrottlerStorage(redis);
      const ok = await storage.increment('k', 60000, 1, 60000, 'default');
      expect(ok.timeToBlockExpire).toBe(0);
      const blocked = await storage.increment('k', 60000, 1, 60000, 'default');
      expect(blocked.isBlocked).toBe(true);
      expect(Number.isInteger(blocked.timeToBlockExpire)).toBe(true);
      expect(blocked.timeToBlockExpire).toBeGreaterThanOrEqual(1);
      expect(blocked.timeToBlockExpire).toBeLessThanOrEqual(60);
      expect(blocked.timeToBlockExpire).toBe(blocked.timeToExpire);
      // Fin de fenêtre : le temps restant est arrondi à 1 s au minimum
      redis.advance(59900);
      const late = await storage.increment('k', 60000, 1, 60000, 'default');
      expect(late.isBlocked).toBe(true);
      expect(late.timeToBlockExpire).toBe(1);
    });

    it('fenêtre fixe : blockDuration ne rallonge pas le blocage, et la fenêtre suivante repart de zéro', async () => {
      const redis = new FakeRedisService();
      const storage = new RedisThrottlerStorage(redis);
      await storage.increment('k', 60000, 1, 3_600_000, 'default');
      const blocked = await storage.increment('k', 60000, 1, 3_600_000, 'default');
      expect(blocked.isBlocked).toBe(true);
      expect(blocked.timeToBlockExpire).toBeLessThanOrEqual(60);
      redis.advance(61000);
      const next = await storage.increment('k', 60000, 1, 3_600_000, 'default');
      expect(next).toMatchObject({ totalHits: 1, isBlocked: false, timeToBlockExpire: 0 });
    });

    it('le repli mémoire reçoit les cinq arguments et bloque aussi (panne de Redis)', async () => {
      const redis = new FakeRedisService();
      redis.mode = 'reject';
      const storage = new RedisThrottlerStorage(redis);
      const a = await storage.increment('k', 60000, 2, 60000, 'default');
      const b = await storage.increment('k', 60000, 2, 60000, 'default');
      const c = await storage.increment('k', 60000, 2, 60000, 'default');
      expect([a.isBlocked, b.isBlocked, c.isBlocked]).toEqual([false, false, true]);
      expect(c.timeToBlockExpire).toBeGreaterThanOrEqual(1);
      storage.onApplicationShutdown();
    });

    it('les cinq arguments sont transmis tels quels au repli', async () => {
      const redis = new FakeRedisService();
      redis.mode = 'reject';
      const fallback = {
        increment: jest.fn().mockResolvedValue({
          totalHits: 1,
          timeToExpire: 1,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      };
      const storage = new RedisThrottlerStorage(redis, fallback);
      await storage.increment('k', 1234, 7, 5678, 'scim-key');
      expect(fallback.increment).toHaveBeenCalledWith('k', 1234, 7, 5678, 'scim-key');
    });
  });
});

/** Le script Lua du vrai `RedisService` : arguments et lecture du résultat. */
describe('S24 : RedisService.incrementWindow', () => {
  it('passe la clé et le TTL en millisecondes à EVAL et convertit la réponse', async () => {
    const evalMock = jest.fn().mockResolvedValue([3, 41234]);
    const service = new RedisService();
    (service as unknown as { redisClient: unknown }).redisClient = { eval: evalMock };
    await expect(service.incrementWindow('throttle:abc', 60000)).resolves.toEqual({
      hits: 3,
      ttlMilliseconds: 41234,
    });
    const [script, keys, key, ttl] = evalMock.mock.calls[0];
    expect(keys).toBe(1);
    expect(key).toBe('throttle:abc');
    expect(ttl).toBe('60000');
    // INCR puis PEXPIRE seulement à la création (PTTL < 0) : fenêtre fixe, atomique
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain("redis.call('PEXPIRE'");
    expect(script).toContain('ttl < 0');
  });
});
