import { createHash } from 'crypto';
import { generateTotpCode } from '../../../src/auth/totp.util';
import {
  E2E_PASSWORD,
  E2eUser,
  E2eWorld,
  cookieLine,
  cookieValue,
  expectRetryAfter,
} from '../support/e2e-world';

/**
 * P7 / authentification et session : verrouillage de compte, rotation et réutilisation du jeton de
 * rafraîchissement, attributs des cookies, 401, MFA (code rejoué, essais épuisés). Application
 * complète, vraie base, vrai Redis ; chaque requête part d'une adresse neuve pour que le
 * limiteur par adresse ne masque pas le contrôle visé (limiteur par compte, jeton, etc.).
 */
describe('P7 e2e : authentification et session', () => {
  let world: E2eWorld;
  const lockoutKey = (email: string, part: 'minute' | 'total' | 'lock', scope = 'login') =>
    `lockout:${scope}:${createHash('sha256').update(email.toLowerCase()).digest('hex')}:${part}`;

  beforeAll(async () => {
    world = await E2eWorld.start();
  });
  afterAll(async () => {
    await world?.close();
  });

  const failLogin = (email: string) =>
    world.request('POST', '/auth/login', { body: { email, passwordRaw: 'MauvaisMotDePasse!1' } });

  describe('verrouillage de compte (S24)', () => {
    it('10 échecs verrouillent le compte : 429 en français avec Retry-After, même avec le bon mot de passe', async () => {
      const victim = await world.createUser({ label: 'lock' });
      // La limite par minute (5) précède le verrou : on vide son compteur entre deux séries
      for (let i = 0; i < 5; i++) expect((await failLogin(victim.email)).status).toBe(401);
      await world.redis.del(lockoutKey(victim.email, 'minute'));
      for (let i = 0; i < 5; i++) expect((await failLogin(victim.email)).status).toBe(401);
      await world.redis.del(lockoutKey(victim.email, 'minute'));
      expect(await world.redis.get(lockoutKey(victim.email, 'lock'))).not.toBeNull();

      const locked = await world.request('POST', '/auth/login', {
        body: { email: victim.email, passwordRaw: E2E_PASSWORD },
      });
      expect(locked.status).toBe(429);
      expect(locked.body.message).toBe(
        'Trop de tentatives échouées : compte temporairement verrouillé, réessayez plus tard.',
      );
      expectRetryAfter(locked, 24 * 3600);
      expect(locked.setCookies).toEqual([]);
    });

    it('le verrou vaut aussi pour un compte inexistant (aucun oracle d’existence)', async () => {
      const ghost = `fantome-${Date.now()}@e2e.example`;
      for (let i = 0; i < 5; i++) await failLogin(ghost);
      await world.redis.del(lockoutKey(ghost, 'minute'));
      for (let i = 0; i < 5; i++) await failLogin(ghost);
      await world.redis.del(lockoutKey(ghost, 'minute'));
      const locked = await failLogin(ghost);
      expect(locked.status).toBe(429);
      expect(locked.body.message).toMatch(/verrouillé/);
    });

    it('plus de 5 tentatives par minute sur un compte : 429 depuis des adresses différentes', async () => {
      const target = await world.createUser({ label: 'minute' });
      for (let i = 0; i < 5; i++) expect((await failLogin(target.email)).status).toBe(401);
      const sixth = await world.request('POST', '/auth/login', {
        body: { email: target.email, passwordRaw: E2E_PASSWORD },
      });
      expect(sixth.status).toBe(429);
      expect(sixth.body.message).toBe('Trop de tentatives échouées : réessayez dans une minute.');
      expectRetryAfter(sixth, 60);
    });
  });

  describe('cookies de session (S7)', () => {
    let user: E2eUser;
    beforeAll(async () => {
      user = await world.createUser({ label: 'cookie' });
    });

    it('accès : HttpOnly, SameSite=Strict, Path=/ ; refresh : Path=/auth ; aucun jeton dans le corps', async () => {
      const { response } = await world.login(user);
      const access = cookieLine(response, 'accessToken')!;
      const refresh = cookieLine(response, 'refreshToken')!;
      expect(access).toMatch(/;\s*HttpOnly/i);
      expect(access).toMatch(/;\s*SameSite=Strict/i);
      expect(access).toMatch(/;\s*Path=\/(;|$)/i);
      expect(refresh).toMatch(/;\s*HttpOnly/i);
      expect(refresh).toMatch(/;\s*SameSite=Strict/i);
      expect(refresh).toMatch(/;\s*Path=\/auth(;|$)/i);
      // Hors production, pas de Secure (le navigateur l'ignorerait en HTTP local)
      expect(access).not.toMatch(/Secure/i);
      expect(response.text).not.toContain(cookieValue(response, 'accessToken')!);
      expect(response.text).not.toContain(cookieValue(response, 'refreshToken')!);
      expect(response.body.accessToken).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
    });

    it('en production : cookies préfixés __Host- / __Secure-, Secure, sans Domain', async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      let response;
      try {
        response = await world.request('POST', '/auth/login', {
          body: { email: user.email, passwordRaw: E2E_PASSWORD },
        });
      } finally {
        process.env.NODE_ENV = previous;
      }
      expect(response.status).toBe(201);
      const access = cookieLine(response, '__Host-accessToken')!;
      const refresh = cookieLine(response, '__Secure-refreshToken')!;
      expect(access).toMatch(/;\s*Secure/i);
      expect(access).toMatch(/;\s*HttpOnly/i);
      expect(access).toMatch(/;\s*SameSite=Strict/i);
      expect(access).toMatch(/;\s*Path=\/(;|$)/i);
      expect(access).not.toMatch(/Domain=/i);
      expect(refresh).toMatch(/;\s*Secure/i);
      expect(refresh).toMatch(/;\s*Path=\/auth(;|$)/i);
      expect(refresh).not.toMatch(/Domain=/i);
    });

    it('la déconnexion efface les deux cookies et révoque la session', async () => {
      const session = await world.login(user);
      const out = await world.request('POST', '/auth/logout', {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      expect(out.status).toBe(204);
      expect(cookieLine(out, 'accessToken')).toMatch(/Expires=Thu, 01 Jan 1970/i);
      expect(cookieLine(out, 'refreshToken')).toMatch(/Expires=Thu, 01 Jan 1970/i);
      const after = await world.request('GET', '/projects/workspaces', {
        accessToken: session.accessToken,
      });
      expect(after.status).toBe(401);
      const refreshed = await world.request('POST', '/auth/refresh', {
        refreshToken: session.refreshToken,
      });
      expect(refreshed.status).toBe(401);
    });
  });

  describe('rotation et réutilisation du jeton de rafraîchissement (S7)', () => {
    let user: E2eUser;
    beforeAll(async () => {
      user = await world.createUser({ label: 'refresh' });
    });

    it('chaque rafraîchissement renvoie de nouveaux jetons ; l’ancien jeton rejoué révoque toute la famille', async () => {
      const first = await world.login(user);
      const rotated = await world.request('POST', '/auth/refresh', {
        refreshToken: first.refreshToken,
      });
      expect(rotated.status).toBe(201);
      const second = {
        accessToken: cookieValue(rotated, 'accessToken')!,
        refreshToken: cookieValue(rotated, 'refreshToken')!,
      };
      expect(second.refreshToken).toBeTruthy();
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessToken).not.toBe(first.accessToken);
      expect(
        (await world.request('GET', '/projects/workspaces', { accessToken: second.accessToken }))
          .status,
      ).toBe(200);

      // Au-delà de la tolérance de concurrence, l'ancien jeton rejoué est un vol présumé
      await world.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: { not: null } },
        data: { rotatedAt: new Date(Date.now() - 60_000) },
      });
      const replay = await world.request('POST', '/auth/refresh', {
        refreshToken: first.refreshToken,
      });
      expect(replay.status).toBe(401);
      // Les cookies sont effacés côté navigateur
      expect(cookieLine(replay, 'refreshToken')).toMatch(/Expires=Thu, 01 Jan 1970/i);

      // La famille entière est morte : le jeton légitime suivant et son jeton d'accès aussi
      const legit = await world.request('POST', '/auth/refresh', {
        refreshToken: second.refreshToken,
      });
      expect(legit.status).toBe(401);
      expect(
        (await world.request('GET', '/projects/workspaces', { accessToken: second.accessToken }))
          .status,
      ).toBe(401);
    });

    it('deux requêtes simultanées avec le même jeton : 409 sans révoquer la session', async () => {
      const first = await world.login(user);
      const rotated = await world.request('POST', '/auth/refresh', {
        refreshToken: first.refreshToken,
      });
      const second = cookieValue(rotated, 'refreshToken')!;
      const concurrent = await world.request('POST', '/auth/refresh', {
        refreshToken: first.refreshToken,
      });
      expect(concurrent.status).toBe(409);
      expect((await world.request('POST', '/auth/refresh', { refreshToken: second })).status).toBe(
        201,
      );
    });

    it('un jeton de rafraîchissement absent ou inventé : 401', async () => {
      expect((await world.request('POST', '/auth/refresh')).status).toBe(401);
      expect(
        (
          await world.request('POST', '/auth/refresh', {
            refreshToken: 'inventé-' + 'x'.repeat(40),
          })
        ).status,
      ).toBe(401);
    });

    it('un jeton d’accès n’est pas un jeton de rafraîchissement', async () => {
      const session = await world.login(user);
      expect(
        (await world.request('POST', '/auth/refresh', { refreshToken: session.accessToken }))
          .status,
      ).toBe(401);
    });
  });

  describe('401 (S3, S7)', () => {
    const PROTECTED: Array<[string, string]> = [
      ['GET', '/projects/workspaces'],
      ['GET', '/projects'],
      ['GET', '/notes'],
      ['GET', '/auth/sessions'],
      ['GET', '/auth/mfa/status'],
      ['GET', '/admin/overview'],
    ];

    it.each(PROTECTED)('sans jeton, %s %s répond 401', async (method, path) => {
      const res = await world.request(method, path);
      expect(res.status).toBe(401);
      expect(res.text).not.toMatch(/stack|prisma|at \S+\.ts/i);
    });

    it('un jeton falsifié ou signé avec un autre secret est rejeté', async () => {
      const user = await world.createUser({ label: '401' });
      const { accessToken } = await world.login(user);
      const [h, p, sig] = accessToken.split('.');
      const tampered = `${h}.${p}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
      expect((await world.request('GET', '/notes', { accessToken: tampered })).status).toBe(401);
      const forgedPayload = Buffer.from(
        JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'autre' }),
      ).toString('base64url');
      expect(
        (await world.request('GET', '/notes', { accessToken: `${h}.${forgedPayload}.${sig}` }))
          .status,
      ).toBe(401);
      expect((await world.request('GET', '/notes', { accessToken: 'n.importe.quoi' })).status).toBe(
        401,
      );
      expect((await world.request('GET', '/notes', { accessToken })).status).toBe(200);
    });

    it('deux cookies d’accès de même nom (cookie tossing) : aucun n’est accepté', async () => {
      const user = await world.createUser({ label: 'toss' });
      const { accessToken } = await world.login(user);
      const res = await world.request('GET', '/notes', {
        headers: { Cookie: `accessToken=${accessToken}; accessToken=${accessToken}` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('MFA : code rejoué et essais épuisés (S6, S24)', () => {
    const startChallenge = async (user: E2eUser) => {
      const res = await world.request('POST', '/auth/login', {
        body: { email: user.email, passwordRaw: E2E_PASSWORD },
      });
      expect(res.body.mfaRequired).toBe(true);
      return res.body.mfaTicket as string;
    };
    const challenge = (mfaTicket: string, code: string) =>
      world.request('POST', '/auth/mfa/challenge', { body: { mfaTicket, code } });

    it('un code TOTP déjà consommé est refusé, même avec un nouveau ticket', async () => {
      const user = await world.createUser({ label: 'replay', mfa: true });
      const code = generateTotpCode(user.mfaSecret!);
      const ok = await challenge(await startChallenge(user), code);
      expect(ok.status).toBe(201);
      const replay = await challenge(await startChallenge(user), code);
      expect(replay.status).toBe(401);
      expect(replay.setCookies).toEqual([]);
      // Le pas suivant n'a pas été consommé : un code frais passe
      const fresh = await challenge(
        await startChallenge(user),
        generateTotpCode(user.mfaSecret!, Date.now() + 30_000),
      );
      expect(fresh.status).toBe(201);
    });

    it('5 essais ratés invalident le ticket, et la limite par compte survit à un nouveau ticket', async () => {
      const user = await world.createUser({ label: 'exhaust', mfa: true });
      const ticket = await startChallenge(user);
      for (let i = 0; i < 5; i++) {
        const wrong = await challenge(ticket, '000000');
        expect(wrong.status).toBe(401);
      }
      // Le ticket est mort : même le bon code ne passe plus
      const dead = await challenge(ticket, generateTotpCode(user.mfaSecret!));
      expect(dead.status).toBe(401);
      expect(dead.setCookies).toEqual([]);

      // Nouveau ticket, bon code : la limite de 5 essais par minute sur le compte tient (429)
      const limited = await challenge(
        await startChallenge(user),
        generateTotpCode(user.mfaSecret!),
      );
      expect(limited.status).toBe(429);
      expect(limited.body.message).toMatch(/Trop de tentatives/);
      expectRetryAfter(limited, 60);
      expect(limited.setCookies).toEqual([]);
    });
  });
});
