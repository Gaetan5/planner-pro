import { RedisService } from '../../../src/redis/redis.service';
import { REDIS_QUIT_TIMEOUT_MS } from '../../../src/common/bounded-quit';

/** O23 / r57-m1 : `RedisService.onModuleDestroy` doit passer par la fermeture bornée `quitWithin`. */
describe('O23 : RedisService.onModuleDestroy', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function serviceWith(client: Record<string, unknown>): RedisService {
    const service = new RedisService();
    (service as unknown as { redisClient: unknown }).redisClient = client;
    return service;
  }

  it('quit() qui ne répond jamais : disconnect() après 2 s, et la fermeture se termine', async () => {
    const client = {
      removeAllListeners: jest.fn(),
      on: jest.fn(),
      quit: jest.fn(() => new Promise<never>(() => undefined)),
      disconnect: jest.fn(),
    };
    let finished = false;
    const destroyed = serviceWith(client)
      .onModuleDestroy()
      .then(() => (finished = true));
    await jest.advanceTimersByTimeAsync(REDIS_QUIT_TIMEOUT_MS - 1);
    expect(client.disconnect).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    await destroyed;
    expect(finished).toBe(true);
  });

  it('quit() abouti : pas de disconnect()', async () => {
    const client = {
      removeAllListeners: jest.fn(),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    };
    await serviceWith(client).onModuleDestroy();
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('sans client (jamais initialisé) : aucune exception', async () => {
    await expect(new RedisService().onModuleDestroy()).resolves.toBeUndefined();
  });
});
