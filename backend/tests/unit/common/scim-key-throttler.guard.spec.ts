import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'crypto';
import {
  SCIM_KEY_LIMIT,
  SCIM_KEY_THROTTLER_NAME,
  SCIM_WINDOW_MS,
  ScimKeyThrottlerGuard,
  THROTTLE_MESSAGE,
} from '../../../src/common/app-throttler.guard';

/** A9-b1 : avec `@nestjs/throttler` 6, c'est `isBlocked` du stockage qui décide, plus `totalHits`. */
describe('A9-b1 : ScimKeyThrottlerGuard', () => {
  function setup(record: object) {
    const increment = jest.fn().mockResolvedValue(record);
    const guard = new ScimKeyThrottlerGuard({ throttlers: [] }, { increment }, new Reflector());
    const header = jest.fn();
    const contextFor = (req: object) =>
      ({
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header }) }),
      }) as unknown as ExecutionContext;
    return { guard, increment, header, contextFor };
  }

  it('refuse sans clé authentifiée, sans consulter le stockage', async () => {
    const { guard, increment, contextFor } = setup({});
    await expect(guard.canActivate(contextFor({}))).rejects.toThrow(ThrottlerException);
    expect(increment).not.toHaveBeenCalled();
  });

  it('interroge le stockage avec la clé hachée, la fenêtre, la limite et le nom dédié', async () => {
    const { guard, increment, contextFor } = setup({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    await expect(guard.canActivate(contextFor({ scimApiKeyId: 'key-1' }))).resolves.toBe(true);
    const expectedKey = createHash('sha256').update('scim-key:key-1').digest('hex');
    expect(increment).toHaveBeenCalledWith(
      expectedKey,
      SCIM_WINDOW_MS,
      SCIM_KEY_LIMIT,
      SCIM_WINDOW_MS,
      SCIM_KEY_THROTTLER_NAME,
    );
    expect(SCIM_KEY_LIMIT).toBe(300);
    expect(SCIM_KEY_THROTTLER_NAME).toBe('scim-key');
  });

  it('isBlocked vrai : 429 avec le message français et Retry-After entier ≥ 1', async () => {
    const { guard, header, contextFor } = setup({
      totalHits: 301,
      timeToExpire: 42,
      isBlocked: true,
      timeToBlockExpire: 41.2,
    });
    const thrown = await guard.canActivate(contextFor({ scimApiKeyId: 'key-1' })).catch((e) => e);
    expect(thrown).toBeInstanceOf(ThrottlerException);
    expect(thrown.message).toBe(THROTTLE_MESSAGE);
    expect(header).toHaveBeenCalledWith('Retry-After', 42);
  });

  it('isBlocked vrai avec un délai nul ou négatif : Retry-After vaut au moins 1', async () => {
    const { guard, header, contextFor } = setup({
      totalHits: 301,
      timeToExpire: 0,
      isBlocked: true,
      timeToBlockExpire: 0,
    });
    await expect(guard.canActivate(contextFor({ scimApiKeyId: 'k' }))).rejects.toThrow();
    expect(header).toHaveBeenCalledWith('Retry-After', 1);
  });

  it('isBlocked faux fait foi : même avec un totalHits au-delà de la limite, la requête passe', async () => {
    const { guard, header, contextFor } = setup({
      totalHits: SCIM_KEY_LIMIT + 1000,
      timeToExpire: 10,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    await expect(guard.canActivate(contextFor({ scimApiKeyId: 'key-1' }))).resolves.toBe(true);
    expect(header).not.toHaveBeenCalled();
  });
});
