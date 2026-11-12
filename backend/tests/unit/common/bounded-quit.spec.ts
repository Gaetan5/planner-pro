import { quitWithin } from '../../../src/common/bounded-quit';

/** O23 : fermeture Redis bornée, ne lève jamais, coupe de force si `quit()` n'aboutit pas. */
describe('O23 : quitWithin', () => {
  it('quit() abouti : pas de disconnect', async () => {
    const client = { quit: jest.fn().mockResolvedValue('OK'), disconnect: jest.fn() };
    await quitWithin(client, 50);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('quit() qui ne répond jamais : disconnect après le délai', async () => {
    const client = {
      quit: jest.fn(() => new Promise<never>(() => undefined)),
      disconnect: jest.fn(),
    };
    const started = Date.now();
    await quitWithin(client, 50);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('quit() rejeté ou levant de façon synchrone : disconnect, sans exception', async () => {
    const rejected = { quit: jest.fn().mockRejectedValue(new Error('x')), disconnect: jest.fn() };
    const thrown = {
      quit: jest.fn(() => {
        throw new TypeError('absent');
      }),
      disconnect: jest.fn(),
    };
    await expect(quitWithin(rejected, 50)).resolves.toBeUndefined();
    await expect(quitWithin(thrown, 50)).resolves.toBeUndefined();
    expect(rejected.disconnect).toHaveBeenCalledTimes(1);
    expect(thrown.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnect() qui échoue (synchrone ou asynchrone) : aucune exception', async () => {
    const sync = {
      quit: jest.fn().mockRejectedValue(new Error('x')),
      disconnect: jest.fn(() => {
        throw new Error('fermé');
      }),
    };
    const asyncFail = {
      quit: jest.fn().mockRejectedValue(new Error('x')),
      disconnect: jest.fn().mockRejectedValue(new Error('fermé')),
    };
    await expect(quitWithin(sync, 50)).resolves.toBeUndefined();
    await expect(quitWithin(asyncFail, 50)).resolves.toBeUndefined();
  });
});
