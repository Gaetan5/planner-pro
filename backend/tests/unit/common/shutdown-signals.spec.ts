import { INestApplication } from '@nestjs/common';
import { installShutdownSignals, SHUTDOWN_DEADLINE_MS } from '../../../src/common/shutdown-signals';

/**
 * O23 / r57-m1 : gardes de l'arrêt propre. Le gestionnaire est installé sur un `process.on` espionné
 * (aucun vrai gestionnaire de signal dans le processus Jest) et `process.exit` est remplacé.
 */
describe('O23 : installShutdownSignals', () => {
  type Handler = (signal: NodeJS.Signals) => void;
  let handlers: Record<string, Handler>;
  let exit: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    handlers = {};
    jest.spyOn(process, 'on').mockImplementation(((event: string, handler: Handler) => {
      handlers[event] = handler;
      return process;
    }) as never);
    exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function install(close: () => Promise<void>): jest.Mock {
    const mock = jest.fn(close);
    installShutdownSignals({ close: mock } as unknown as INestApplication);
    return mock;
  }

  it('écoute SIGTERM et SIGINT', () => {
    install(() => Promise.resolve());
    expect(Object.keys(handlers).sort()).toEqual(['SIGINT', 'SIGTERM']);
  });

  it('SIGTERM puis SIGINT rapprochés : un seul close()', async () => {
    const close = install(() => new Promise<void>(() => undefined));
    handlers.SIGTERM('SIGTERM');
    handlers.SIGINT('SIGINT');
    handlers.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(50);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('sortie en code 0 seulement une fois close() résolu', async () => {
    let done!: () => void;
    install(() => new Promise<void>((resolve) => (done = resolve)));
    handlers.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(100);
    expect(exit).not.toHaveBeenCalled();
    done();
    await jest.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('close() qui échoue : sortie en code 1', async () => {
    install(() => Promise.reject(new Error('Prisma indisponible')));
    handlers.SIGINT('SIGINT');
    await jest.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('filet : close() qui ne se termine jamais, sortie en code 1 à 8 s (ni avant, ni bien après)', async () => {
    expect(SHUTDOWN_DEADLINE_MS).toBe(8000);
    install(() => new Promise<void>(() => undefined));
    handlers.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
