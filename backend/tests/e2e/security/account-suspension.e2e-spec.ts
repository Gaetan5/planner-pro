import { createHash, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { SESSION_CACHE_TTL_SECONDS } from '../../../src/auth/session.service';
import { E2E_PASSWORD, E2eSession, E2eUser, E2eWorld } from '../support/e2e-world';

/**
 * P7-b (O-d) : retrait d'accès d'un compte, par l'administration et par SCIM.
 *
 * Trois chemins existent, avec trois délais différents :
 *  - révocation des sessions par un administrateur de la plateforme : immédiate (le cache de
 *    session est invalidé avec la session) ;
 *  - compte marqué suspendu (`User.isSuspended`, aucune route applicative ne l'écrit, seule la
 *    base ou un outil d'exploitation) : connexion et rafraîchissement refusés tout de suite,
 *    mais une session déjà validée reste acceptée jusqu'à l'expiration de son cache, 60 s au plus ;
 *  - désactivation SCIM (`active: false`) : SCIM ne suspend jamais le compte (S1), il retire
 *    l'appartenance à l'espace ; l'accès aux données de l'espace est refusé immédiatement, car
 *    chaque requête relit l'appartenance en base.
 */
describe('P7-b e2e : retrait d’accès d’un compte (O-d)', () => {
  let world: E2eWorld;
  let redis: Redis;
  beforeAll(async () => {
    world = await E2eWorld.start();
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  });
  afterAll(async () => {
    delete process.env.FEATURE_SCIM_ENABLED;
    await redis?.quit();
    await world?.close();
  });

  const sessionCacheKey = (accessToken: string) => {
    const sid = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()).sid;
    return `session:active:${sid}`;
  };
  const read = (session: E2eSession) =>
    world.request('GET', '/projects/workspaces', { accessToken: session.accessToken });
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('administration : la révocation des sessions d’un compte coupe son accès tout de suite', async () => {
    const superAdmin = await world.createUser({ label: 'susp-admin', platformRole: 'SUPER_ADMIN' });
    const target = await world.createUser({ label: 'susp-cible' });
    const session = await world.login(target);
    expect((await read(session)).status).toBe(200);
    // Le statut est en cache : sans invalidation, la session resterait acceptée
    expect(await redis.exists(sessionCacheKey(session.accessToken))).toBe(1);

    const admin = await world.login(superAdmin);
    const revoke = await world.request('POST', `/admin/users/${target.id}/revoke-sessions`, {
      accessToken: admin.accessToken,
    });
    expect(revoke.status).toBe(201);
    expect(revoke.body.revokedCount).toBe(1);

    expect((await read(session)).status).toBe(401);
    expect(await redis.exists(sessionCacheKey(session.accessToken))).toBe(0);
    const refresh = await world.request('POST', '/auth/refresh', {
      refreshToken: session.refreshToken,
    });
    expect(refresh.status).toBe(401);
    // Le compte peut se reconnecter : une révocation n'est pas une suspension
    expect((await world.login(target)).accessToken).toBeTruthy();
  });

  it('compte suspendu : connexion et rafraîchissement refusés tout de suite, session déjà validée acceptée 60 s au plus', async () => {
    const target = await world.createUser({ label: 'susp-flag' });
    const session = await world.login(target);
    const other = await world.login(target);
    expect((await read(session)).status).toBe(200);
    expect((await read(other)).status).toBe(200);
    const key = sessionCacheKey(session.accessToken);
    // Fenêtre documentée : la validité du cache est bornée à 60 s
    const ttl = await redis.ttl(key);
    expect(SESSION_CACHE_TTL_SECONDS).toBe(60);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    await world.prisma.user.update({ where: { id: target.id }, data: { isSuspended: true } });

    // Fenêtre acceptée (O-d) : tant que le cache vit, la session déjà validée passe encore
    expect((await read(session)).status).toBe(200);

    // Pas de nouvelle session pour un compte suspendu, dès la première seconde
    const login = await world.request('POST', '/auth/login', {
      body: { email: target.email, passwordRaw: E2E_PASSWORD },
    });
    expect(login.status).toBe(403);
    expect(login.body.message).toMatch(/suspendu/);

    // Un rafraîchissement refuse et révoque la session concernée sur-le-champ (cache compris)
    const refresh = await world.request('POST', '/auth/refresh', {
      refreshToken: other.refreshToken,
    });
    expect(refresh.status).toBe(401);
    expect((await read(other)).status).toBe(401);

    // Fin de la fenêtre pour l'autre session : le cache expire (raccourci à 1 s au lieu de 60 s)
    await redis.expire(key, 1);
    await sleep(1500);
    expect(await redis.exists(key)).toBe(0);
    expect((await read(session)).status).toBe(401);
    // La décision est prise en base et ne revient pas dans le cache
    expect(await redis.exists(key)).toBe(0);
  });

  describe('SCIM : désactivation d’un compte', () => {
    const token = `scim_live_${randomUUID().replace(/-/g, '')}`;
    const scim = (method: string, path: string, body?: unknown) =>
      world.request(method, path, {
        headers: { Authorization: `Bearer ${token}` },
        raw: body === undefined ? undefined : JSON.stringify(body),
        contentType: 'application/scim+json',
      });
    let owner: E2eUser;
    let member: E2eUser;
    let ws: string;

    beforeAll(async () => {
      process.env.FEATURE_SCIM_ENABLED = 'true';
      owner = await world.createUser({ label: 'scim-owner' });
      member = await world.createUser({ label: 'scim-membre' });
      ws = await world.createWorkspace(owner, 'Espace SCIM suspension');
      await world.addMember(ws, member, 'MEMBER');
      await world.prisma.sCIMApiKey.create({
        data: {
          workspaceId: ws,
          name: 'clé suspension',
          tokenHash: createHash('sha256').update(token).digest('hex'),
        },
      });
    });

    it('active:false retire l’accès à l’espace immédiatement, sans suspendre le compte', async () => {
      const session = await world.login(member);
      const members = () =>
        world.request('GET', `/projects/workspaces/${ws}/members`, {
          accessToken: session.accessToken,
        });
      expect((await members()).status).toBe(200);

      const patch = await scim('PATCH', `/scim/v2/Users/${member.id}`, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      });
      expect(patch.status).toBe(200);
      expect(patch.body.active).toBe(false);

      // Aucune attente : l'appartenance est relue en base à chaque requête
      expect([403, 404]).toContain((await members()).status);
      expect(
        await world.prisma.membership.count({ where: { workspaceId: ws, userId: member.id } }),
      ).toBe(0);
      const listed = await read(session);
      expect(listed.status).toBe(200);
      expect(listed.text).not.toContain(ws);

      // SCIM n'écrit jamais `isSuspended` (S1) : le compte et sa session restent valides
      const account = await world.prisma.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(account.isSuspended).toBe(false);
      expect((await world.login(member)).accessToken).toBeTruthy();
    });

    it('active:true par un IdP ne rend pas l’accès à un compte qu’il n’a pas provisionné', async () => {
      const outsider = await world.createUser({ label: 'scim-hors' });
      const attempt = await scim('PATCH', `/scim/v2/Users/${outsider.id}`, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: true }],
      });
      expect(attempt.status).toBe(404);
      expect(
        await world.prisma.membership.count({ where: { workspaceId: ws, userId: outsider.id } }),
      ).toBe(0);
    });
  });
});
