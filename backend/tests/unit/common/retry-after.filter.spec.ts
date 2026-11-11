import { ArgumentsHost } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  AccountLockout,
  LOCKOUT_BASE_SECONDS,
  LOCKOUT_THRESHOLD,
  TooManyAttemptsException,
} from '../../../src/auth/account-lockout';
import { RetryAfterFilter } from '../../../src/common/retry-after.filter';
import { FakeRedisService } from '../../http/fake-redis';

/** P7 : le 429 par compte porte `Retry-After`, sans changer le message ni le statut. */
describe('P7 : RetryAfterFilter', () => {
  const run = (exception: TooManyAttemptsException) => {
    const calls: { status?: number; headers: Record<string, string>; body?: unknown } = {
      headers: {},
    };
    const response = {
      status(code: number) {
        calls.status = code;
        return response;
      },
      set(name: string, value: string) {
        calls.headers[name] = value;
        return response;
      },
      json(body: unknown) {
        calls.body = body;
        return response;
      },
    };
    new RetryAfterFilter().catch(exception, {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost);
    return calls;
  };

  it('publie le délai en secondes et conserve le message en français', () => {
    const calls = run(new TooManyAttemptsException('Trop de tentatives échouées.', 42));
    expect(calls.status).toBe(429);
    expect(calls.headers['Retry-After']).toBe('42');
    expect(calls.body).toEqual({ statusCode: 429, message: 'Trop de tentatives échouées.' });
  });

  it('ne publie jamais un délai nul ou négatif', () => {
    expect(run(new TooManyAttemptsException('x', 0)).headers['Retry-After']).toBe('1');
  });

  it('un verrou posé indique le temps restant, un ancien verrou « 1 » retombe sur la durée de base', async () => {
    const redis = new FakeRedisService();
    const lockout = new AccountLockout(redis as never, 'login');
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) await lockout.recordFailure('a@e2e.example');
    const error = await lockout.assertAllowed('a@e2e.example').catch((e) => e);
    expect(error).toBeInstanceOf(TooManyAttemptsException);
    expect(error.retryAfterSeconds).toBeGreaterThan(LOCKOUT_BASE_SECONDS - 5);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(LOCKOUT_BASE_SECONDS);

    const legacy = new FakeRedisService();
    const old = new AccountLockout(legacy as never, 'login');
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) await old.recordFailure('b@e2e.example');
    const hash = createHash('sha256').update('b@e2e.example').digest('hex');
    await legacy.set(`lockout:login:${hash}:lock`, '1', 60);
    const legacyError = await old.assertAllowed('b@e2e.example').catch((e) => e);
    expect(legacyError.retryAfterSeconds).toBe(LOCKOUT_BASE_SECONDS);
  });
});
