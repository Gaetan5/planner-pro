import { E2eResponse, E2eWorld } from '../support/e2e-world';

/**
 * r56-m1 : comportement de l'anti-CSRF par `Origin` (S29, `originCheckMiddleware`) sur
 * l'application câblée par `configureHttpApp` (comme `main.ts`). Une requête à effet qui porte un
 * cookie de session doit venir d'une `Origin` (à défaut, d'un `Referer`) autorisée. Ces tests
 * doivent rester verts après A9-b2 (Express 5 : `req.path`, ordre des analyseurs).
 */
const ORIGIN = 'http://localhost:3000';
const EVIL = 'https://evil.example';
const MESSAGE = 'Origine de la requête non autorisée.';
const PROJECT = '00000000-0000-4000-8000-000000000001';

describe('r56-m1 e2e : anti-CSRF par Origin avec cookie de session', () => {
  let world: E2eWorld;
  const previousCors = process.env.CORS_ORIGINS;

  beforeAll(async () => {
    process.env.CORS_ORIGINS = ORIGIN;
    world = await E2eWorld.start();
  });
  afterAll(async () => {
    await world.app.close();
    if (previousCors === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousCors;
  });

  /** Requête portant un cookie de session (valeur quelconque) et les en-têtes d'origine voulus. */
  const send = (
    method: string,
    path: string,
    headers: Record<string, string> = {},
    cookie = 'refreshToken=valeur-quelconque',
  ): Promise<E2eResponse> =>
    world.request(method, path, { headers: { Cookie: cookie, ...headers } });

  function expectBlocked(res: E2eResponse): void {
    expect([res.status, (res.body as { message?: string }).message]).toEqual([403, MESSAGE]);
  }

  it('sans Origin ni Referer : 403', async () => {
    expectBlocked(await send('POST', '/auth/logout'));
    expectBlocked(await send('POST', '/auth/refresh'));
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s sans Origin avec cookie : 403',
    async (method) => {
      expectBlocked(await send(method, '/auth/logout'));
    },
  );

  it('Origin inconnue : 403, même avec un Referer autorisé (l’Origin prime)', async () => {
    expectBlocked(await send('POST', '/auth/logout', { Origin: EVIL }));
    expectBlocked(await send('POST', '/auth/logout', { Origin: EVIL, Referer: `${ORIGIN}/page` }));
  });

  it('Referer inconnu ou illisible sans Origin : 403', async () => {
    expectBlocked(await send('POST', '/auth/logout', { Referer: `${EVIL}/page` }));
    expectBlocked(await send('POST', '/auth/logout', { Referer: 'pas une url' }));
  });

  it('Origin autorisée : la requête passe (refresh : 401 cookie invalide, logout : 204)', async () => {
    expect((await send('POST', '/auth/logout', { Origin: ORIGIN })).status).toBe(204);
    expect((await send('POST', '/auth/refresh', { Origin: ORIGIN })).status).toBe(401);
  });

  it('Referer autorisé sans Origin : la requête passe (refresh : 401)', async () => {
    expect(
      (await send('POST', '/auth/refresh', { Referer: `${ORIGIN}/projets/1?x=2` })).status,
    ).toBe(401);
  });

  it('cookie d’accès (et variantes préfixées) : mêmes règles', async () => {
    for (const cookie of ['accessToken=x', '__Host-accessToken=x', '__Secure-refreshToken=x']) {
      expectBlocked(await send('POST', '/auth/logout', {}, cookie));
      expect((await send('POST', '/auth/refresh', { Origin: ORIGIN }, cookie)).status).toBe(401);
    }
  });

  it('GET avec cookie sans Origin : pas de 403 (requête sans effet)', async () => {
    const res = await send('GET', '/auth/sessions');
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(401);
  });

  it('sans cookie de session (cookie étranger, Bearer) : jamais de 403 d’origine', async () => {
    const foreign = await send('POST', '/auth/refresh', {}, 'autre=1');
    expect(foreign.status).toBe(401);
    const bearer = await world.request('POST', '/auth/refresh', { bearer: 'jeton-invalide' });
    expect(bearer.status).toBe(401);
  });

  it('chemins exemptés (webhook GitHub du projet, SCIM) : pas de 403 d’origine avec cookie', async () => {
    for (const path of [
      `/projects/${PROJECT}/webhooks/github`,
      `/projects/${PROJECT}/webhooks/github/`,
    ]) {
      const res = await send('POST', path);
      expect([res.status, (res.body as { message?: string }).message]).not.toEqual([403, MESSAGE]);
    }
    for (const path of ['/scim/v2/Users', '/scim/v2/Groups', '/scim/v2']) {
      const res = await send('POST', path);
      expect([res.status, (res.body as { message?: string }).message]).not.toEqual([403, MESSAGE]);
    }
  });

  it('exemptions étroites : le secret du webhook et un SCIM voisin ne sont pas exemptés', async () => {
    expectBlocked(await send('POST', `/projects/${PROJECT}/webhooks/github/secret`));
    expectBlocked(await send('POST', '/scim/v2x/Users'));
    expectBlocked(await send('POST', '/scimv2/Users'));
  });

  it('figé : l’exemption est sensible à la casse (/Projects/<id>/WEBHOOKS/GitHub/ : 403, échec fermé)', async () => {
    // Le routage ne l'est pas (A9-b0) : un changement ici doit être voulu, pas un effet de bord d'Express 5.
    expectBlocked(await send('POST', `/Projects/${PROJECT}/WEBHOOKS/GitHub/`));
    expectBlocked(await send('POST', `/Projects/${PROJECT}/webhooks/github`));
    expectBlocked(await send('POST', '/SCIM/v2/Users'));
  });
});
