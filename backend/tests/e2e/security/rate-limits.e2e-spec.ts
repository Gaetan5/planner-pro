import { E2eWorld, expectRetryAfter } from '../support/e2e-world';

/**
 * P7 / limiteurs (S24) : 429 du limiteur global et des routes publiques (message français,
 * `Retry-After`), adresse cliente fiable derrière un proxy (`trust proxy`, `X-Forwarded-For`).
 * Chaque test choisit son adresse : les compteurs de débit sont isolés.
 */
describe('P7 e2e : limiteurs de débit', () => {
  let world: E2eWorld;
  beforeAll(async () => {
    world = await E2eWorld.start();
  });
  afterAll(async () => {
    await world?.close();
  });

  const TOO_MANY = 'Trop de requêtes. Réessayez dans quelques instants.';

  /** Envoie `count` requêtes d'affilée et renvoie les statuts dans l'ordre. */
  async function burst(count: number, send: (i: number) => Promise<{ status: number }>) {
    const statuses: number[] = [];
    for (let i = 0; i < count; i++) statuses.push((await send(i)).status);
    return statuses;
  }

  it('limiteur global : 60 requêtes par minute et par adresse, la 61e reçoit un 429 en français avec Retry-After', async () => {
    const ip = world.nextIp();
    const statuses = await burst(60, () => world.request('GET', '/projects/workspaces', { ip }));
    expect(new Set(statuses)).toEqual(new Set([401]));
    const limited = await world.request('GET', '/projects/workspaces', { ip });
    expect(limited.status).toBe(429);
    expect(limited.body.message).toBe(TOO_MANY);
    expectRetryAfter(limited, 60);
    // Une autre adresse n'est pas touchée
    expect((await world.request('GET', '/projects/workspaces')).status).toBe(401);
  });

  it('route publique à limite basse : /auth/password/forgot, 3 par minute et par adresse', async () => {
    const ip = world.nextIp();
    const statuses = await burst(4, () =>
      world.request('POST', '/auth/password/forgot', {
        ip,
        body: { email: `inconnu-${Date.now()}@e2e.example` },
      }),
    );
    expect(statuses).toEqual([202, 202, 202, 429]);
    const limited = await world.request('POST', '/auth/password/forgot', {
      ip,
      body: { email: 'autre@e2e.example' },
    });
    expect(limited.body.message).toBe(TOO_MANY);
    expectRetryAfter(limited, 60);
  });

  it('inscription et connexion : 5 par minute et par adresse', async () => {
    const ip = world.nextIp();
    const login = await burst(6, (i) =>
      world.request('POST', '/auth/login', {
        ip,
        body: { email: `rl-${i}-${Date.now()}@e2e.example`, passwordRaw: 'MauvaisMotDePasse!1' },
      }),
    );
    expect(login).toEqual([401, 401, 401, 401, 401, 429]);
    const ip2 = world.nextIp();
    const register = await burst(6, (i) =>
      world.request('POST', '/auth/register', {
        ip: ip2,
        body: { email: `reg-${i}`, passwordRaw: 'x', name: 'x' },
      }),
    );
    expect(register.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(register[5]).toBe(429);
  });

  describe('trust proxy et X-Forwarded-For', () => {
    const forgot = (xff: string) =>
      world.request('POST', '/auth/password/forgot', {
        ip: null,
        headers: { 'X-Forwarded-For': xff },
        body: { email: 'spoof@e2e.example' },
      });

    it('une adresse falsifiée à gauche du proxy de confiance ne change pas de compteur', async () => {
      // Le proxy (1 saut) ajoute l'adresse réelle à droite ; le client contrôle ce qui précède
      const real = world.nextIp();
      const statuses = await burst(4, (i) => forgot(`203.0.113.${i + 1}, ${real}`));
      expect(statuses).toEqual([202, 202, 202, 429]);
    });

    it('des adresses réelles différentes ont chacune leur compteur', async () => {
      const statuses = await burst(4, () => forgot(world.nextIp()));
      expect(statuses).toEqual([202, 202, 202, 202]);
    });

    it('un en-tête X-Forwarded-For illisible ne provoque ni 5xx ni contournement', async () => {
      const real = world.nextIp();
      const statuses = await burst(4, () => forgot(`pas-une-adresse, ${real}`));
      expect(statuses).toEqual([202, 202, 202, 429]);
    });

    it('sans proxy de confiance (TRUST_PROXY_HOPS=0), X-Forwarded-For est ignoré', async () => {
      const direct = await E2eWorld.start({ trustProxyHops: '0' });
      try {
        const statuses = await burst(4, () =>
          direct.request('POST', '/auth/password/forgot', {
            ip: direct.nextIp(), // adresse différente à chaque requête : sans effet
            body: { email: 'direct@e2e.example' },
          }),
        );
        // Tous les clients partagent l'adresse de la connexion : le 4e passage est refusé.
        // (Compteurs persistants d'une exécution précédente : au moins un 429 sur les quatre.)
        expect(statuses).toContain(429);
        expect(statuses.filter((s) => s === 202).length).toBeLessThanOrEqual(3);
      } finally {
        await direct.close();
      }
    });
  });
});
