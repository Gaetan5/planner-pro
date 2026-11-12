import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import { RealtimeService } from '../../../src/realtime/realtime.service';
import { startE2eApp } from '../support/e2e-app';
import { E2eWorld } from '../support/e2e-world';

/**
 * A9-b2 (R7) : temps réel sur NestJS 11 et `@nestjs/platform-socket.io` 11. Deux instances de
 * l'application complète partagent le même Redis (adaptateur `@socket.io/redis-adapter`) : un
 * événement émis par l'instance A atteint un client connecté à l'instance B ; sans jeton, la
 * connexion est refusée ; l'arrêt des deux instances ne lève pas d'erreur.
 */
describe('A9-b2 : Socket.IO sur deux instances reliées au même Redis', () => {
  jest.setTimeout(60_000);
  let world: E2eWorld;
  let second: INestApplication;
  let secondUrl: string;
  const clients: Socket[] = [];

  beforeAll(async () => {
    world = await E2eWorld.start();
    const started = await startE2eApp();
    second = started.app;
    secondUrl = started.baseUrl;
  });

  afterAll(async () => {
    for (const client of clients) client.close();
    await second.close();
    await world.cleanup();
    await world.close();
  });

  /** Attend un événement, avec une borne de 10 s dont la minuterie est toujours libérée. */
  const waitFor = (socket: Socket, events: string[], label: string) =>
    new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label)), 10_000);
      for (const event of events) {
        socket.once(event, (payload: unknown) => {
          clearTimeout(timer);
          resolve(payload);
        });
      }
    });

  const connect = (url: string, token?: string): Socket => {
    const socket = io(url, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    clients.push(socket);
    return socket;
  };

  it('sans jeton : aucune session temps réel (déconnexion, jamais `active-timer-state`)', async () => {
    const socket = connect(secondUrl);
    let ready = false;
    socket.on('active-timer-state', () => (ready = true));
    await waitFor(socket, ['disconnect', 'connect_error'], 'connexion non refusée');
    expect(ready).toBe(false);
  });

  it('un événement émis sur A atteint un client connecté à B, et inversement', async () => {
    const user = await world.createUser({ label: 'rt' });
    const { accessToken } = await world.login(user);
    const onB = connect(secondUrl, accessToken);
    const onA = connect(world.baseUrl, accessToken);
    await Promise.all(
      [onA, onB].map((socket) =>
        waitFor(socket, ['active-timer-state'], 'connexion temps réel non établie'),
      ),
    );

    const receivedOnB = waitFor(onB, ['a9b2-ping'], 'a9b2-ping non reçu');
    world.app.get(RealtimeService).emitToUser(user.id, 'a9b2-ping', { from: 'A' });
    await expect(receivedOnB).resolves.toEqual({ from: 'A' });

    const receivedOnA = waitFor(onA, ['a9b2-pong'], 'a9b2-pong non reçu');
    second.get(RealtimeService).emitToUser(user.id, 'a9b2-pong', { from: 'B' });
    await expect(receivedOnA).resolves.toEqual({ from: 'B' });
  });
});
