import { E2eWorld } from '../support/e2e-world';

/**
 * O22 : `app.close()` doit fermer toutes les connexions ouvertes par l'application (pool MySQL,
 * clients Redis du service et de l'adaptateur Socket.IO). Sans cela, un processus de test ne se
 * termine pas seul (il fallait `forceExit`) et un arrêt de production laisse des connexions
 * pendantes côté MySQL et Redis.
 */
interface SocketHandle {
  constructor: { name: string };
  remotePort?: number;
  destroyed?: boolean;
}

function openPeerPorts(): number[] {
  const watched = new Set([
    Number(new URL(process.env.E2E_DATABASE_URL!).port || 3306),
    Number(process.env.REDIS_PORT || 6379),
  ]);
  const handles = (
    process as unknown as { _getActiveHandles(): SocketHandle[] }
  )._getActiveHandles();
  return handles
    .filter(
      (h) => h.constructor.name === 'Socket' && !h.destroyed && watched.has(h.remotePort ?? -1),
    )
    .map((h) => h.remotePort as number);
}

describe('O22 e2e : arrêt propre de l’application', () => {
  it('app.close() ne laisse aucune connexion MySQL ni Redis ouverte', async () => {
    const world = await E2eWorld.start();
    // Connexion Redis prête (sinon la fermeture interrompt une poignée de main en cours)
    await world.redis.ping();
    // Les clients sont bien ouverts tant que l'application tourne
    expect(openPeerPorts().length).toBeGreaterThan(0);

    await world.app.close();
    // Laisse le temps aux sockets fermées de quitter la liste des handles actifs
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(openPeerPorts()).toEqual([]);
  });
});
