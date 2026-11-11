import { RedisService } from '../../../src/redis/redis.service';
import { RedisThrottlerStorage, WindowCounter } from '../../../src/common/redis-throttler.storage';
import { FakeRedisService } from '../../http/fake-redis';

/** S24 : stockage du limiteur dans Redis, partagé entre instances, avec repli mémoire. */
describe('S24 : RedisThrottlerStorage', () => {
  it('deux instances partagent le même compteur (multi-instance)', async () => {
    const redis = new FakeRedisService();
    const a = new RedisThrottlerStorage(redis);
    const b = new RedisThrottlerStorage(redis);
    expect((await a.increment('k', 60000)).totalHits).toBe(1);
    expect((await b.increment('k', 60000)).totalHits).toBe(2);
    expect((await a.increment('k', 60000)).totalHits).toBe(3);
    expect((await b.increment('autre', 60000)).totalHits).toBe(1);
    // Clés préfixées : pas de collision avec le reste de Redis
    expect([...redis.store.keys()].every((key) => key.startsWith('throttle:'))).toBe(true);
  });

  it('timeToExpire est en secondes (Retry-After) et la fenêtre expire', async () => {
    const redis = new FakeRedisService();
    const storage = new RedisThrottlerStorage(redis);
    const first = await storage.increment('k', 60000);
    expect(first.timeToExpire).toBeGreaterThan(55);
    expect(first.timeToExpire).toBeLessThanOrEqual(60);
    redis.advance(61000);
    expect((await storage.increment('k', 60000)).totalHits).toBe(1);
  });

  it('Redis en erreur : repli sur un compteur local, jamais d’exception', async () => {
    const redis = new FakeRedisService();
    redis.mode = 'reject';
    const storage = new RedisThrottlerStorage(redis);
    expect((await storage.increment('k', 60000)).totalHits).toBe(1);
    expect((await storage.increment('k', 60000)).totalHits).toBe(2);
    storage.onApplicationShutdown();
  });

  it('Redis qui ne répond pas : repli après le délai', async () => {
    const redis = new FakeRedisService();
    redis.mode = 'hang';
    const storage = new RedisThrottlerStorage(redis, undefined, 50);
    const started = Date.now();
    expect((await storage.increment('k', 60000)).totalHits).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
    storage.onApplicationShutdown();
  });

  it('disjoncteur : 100 appels pendant une panne n’ajoutent pas 100 délais (r44-a2)', async () => {
    const redis = new FakeRedisService();
    redis.mode = 'hang';
    const storage = new RedisThrottlerStorage(redis, undefined, 100);
    const started = Date.now();
    for (let i = 0; i < 100; i++) await storage.increment(`k${i % 3}`, 60000);
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
    for (let i = 0; i < 5; i++) await storage.increment('k', 60000);
    expect(warn).toHaveBeenCalledTimes(1);
    storage.onApplicationShutdown();
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
