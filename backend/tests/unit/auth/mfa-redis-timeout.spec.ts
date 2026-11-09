import { ServiceUnavailableException } from '@nestjs/common';
import { AuthService, MFA_REDIS_TIMEOUT_MS } from '../../../src/auth/auth.service';

type WithTimeout = { withRedisTimeout<T>(op: () => Promise<T>): Promise<T> };

/**
 * O19 : le délai par défaut du parcours MFA reste de 2 s en production ; le test HTTP, lui, injecte
 * un délai court. Ici, la valeur par défaut est vérifiée avec des temporisateurs simulés.
 */
describe('délai Redis du parcours MFA (O19)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const build = (timeout?: number) =>
    (timeout === undefined
      ? new AuthService(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        )
      : new AuthService(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          timeout,
        )) as unknown as WithTimeout;

  it('la valeur par défaut est de 2000 ms', () => {
    expect(MFA_REDIS_TIMEOUT_MS).toBe(2000);
  });

  it('une commande suspendue est rejetée (503) au bout de 2000 ms par défaut, et pas avant', async () => {
    const service = build();
    let settled = false;
    const call = service
      .withRedisTimeout(() => new Promise<never>(() => undefined))
      .catch((err: unknown) => {
        settled = true;
        return err;
      });
    await jest.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await call).toBeInstanceOf(ServiceUnavailableException);
  });

  it('un délai injecté remplace la valeur par défaut', async () => {
    const service = build(200);
    const call = service
      .withRedisTimeout(() => new Promise<never>(() => undefined))
      .catch((err: unknown) => err);
    await jest.advanceTimersByTimeAsync(200);
    expect(await call).toBeInstanceOf(ServiceUnavailableException);
  });

  it('une commande rapide aboutit sans 503', async () => {
    await expect(build().withRedisTimeout(async () => 'ok')).resolves.toBe('ok');
  });
});
