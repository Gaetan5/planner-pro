import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { createServer, AddressInfo, Server, Socket } from 'net';
import { join } from 'path';
import { prepareE2eEnvironment } from '../support/e2e-app';

/**
 * O23 : le vrai point d'entrée compilé (`node dist/main`) doit s'arrêter proprement sur SIGTERM
 * (code de sortie 0, pas une mort par signal) en moins de 5 s, y compris quand Redis est injoignable.
 * Dans un conteneur, Node est le PID 1 : sans gestionnaire de signal (`enableShutdownHooks()`),
 * SIGTERM est ignoré et `docker stop` finit en SIGKILL (137). `quit()` des clients Redis est borné
 * à 2 s : sans cela, un arrêt pendant une panne de Redis attendrait indéfiniment la reconnexion.
 * Prérequis : `pnpm build` (le test échoue explicitement si `dist/main.js` est absent).
 */
const MAIN = join(__dirname, '../../../dist/main.js');
const MAX_STOP_MS = 5000;

/** Relais TCP vers Redis, que le test peut couper pour simuler une panne sans toucher au vrai Redis. */
class RedisProxy {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();

  private constructor() {
    this.server = createServer((client) => {
      const upstream = new Socket();
      this.sockets.add(client).add(upstream);
      upstream.connect(
        Number(process.env.REDIS_PORT || 6379),
        process.env.REDIS_HOST || '127.0.0.1',
      );
      client.pipe(upstream).pipe(client);
      for (const s of [client, upstream]) {
        s.on('error', () => s.destroy());
        s.on('close', () => {
          this.sockets.delete(s);
          (s === client ? upstream : client).destroy();
        });
      }
    });
  }

  static async start(): Promise<RedisProxy> {
    const proxy = new RedisProxy();
    await new Promise<void>((resolve) => proxy.server.listen(0, '127.0.0.1', resolve));
    return proxy;
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  /** Panne : plus aucune connexion acceptée, les connexions établies sont coupées. */
  async cut(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  async stop(): Promise<void> {
    if (this.server.listening) await this.cut();
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface Started {
  child: ChildProcess;
  output: () => string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>;
}

async function startBackend(redisPort: number): Promise<Started> {
  const port = await freePort();
  let log = '';
  const child = spawn(process.execPath, [MAIN], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(redisPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (chunk) => (log += chunk));
  child.stderr!.on('data', (chunk) => (log += chunk));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>(
    (resolve) => child.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() })),
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Démarrage trop long :\n${log}`)), 20000);
    const check = setInterval(() => {
      if (log.includes('Backend NestJS running on')) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 100);
    void exit.then(() => {
      clearTimeout(timer);
      clearInterval(check);
      reject(new Error(`Processus terminé avant démarrage :\n${log}`));
    });
  });
  return { child, output: () => log, exit };
}

describe('O23 e2e : arrêt du processus réel sur SIGTERM', () => {
  let proxy: RedisProxy;
  let running: Started | undefined;

  beforeAll(() => {
    prepareE2eEnvironment();
    if (!existsSync(MAIN)) {
      throw new Error('dist/main.js absent : lancer `pnpm build` avant ce test (O23).');
    }
  });
  beforeEach(async () => {
    proxy = await RedisProxy.start();
  });
  afterEach(async () => {
    if (running && running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill('SIGKILL');
      await running.exit;
    }
    running = undefined;
    await proxy.stop();
  });

  async function stopWithSigterm(): Promise<{
    elapsed: number;
    code: number | null;
    signal: unknown;
  }> {
    const started = running!;
    const sentAt = Date.now();
    started.child.kill('SIGTERM');
    // Garde-fou : sans gestionnaire, le test ne doit pas attendre indéfiniment
    const result = await Promise.race([
      started.exit,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), MAX_STOP_MS + 3000)),
    ]);
    if (!result) return { elapsed: Infinity, code: null, signal: 'aucune sortie' };
    return { elapsed: result.at - sentAt, code: result.code, signal: result.signal };
  }

  it('SIGTERM : sortie en code 0 en moins de 5 s', async () => {
    running = await startBackend(proxy.port);
    const { elapsed, code, signal } = await stopWithSigterm();
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(elapsed).toBeLessThan(MAX_STOP_MS);
  });

  it('SIGTERM avec Redis injoignable : sortie en code 0 en moins de 5 s (quit() borné)', async () => {
    running = await startBackend(proxy.port);
    await proxy.cut();
    // Laisse les clients Redis détecter la coupure et entrer en reconnexion
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { elapsed, code, signal } = await stopWithSigterm();
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(elapsed).toBeLessThan(MAX_STOP_MS);
  });
});
