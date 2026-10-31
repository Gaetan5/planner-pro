import { Controller, Get, INestApplication, Req, UseGuards } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../src/auth/firebase-identity.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { hashPassword } from '../../src/auth/encryption.util';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { TokenModule } from '../../src/auth/token.module';
import { SessionService } from '../../src/auth/session.service'; // SESSION
import { MailService } from '../../src/mail/mail.service';
import { FakePrisma } from './fake-prisma';
import { FakeRedisService } from './fake-redis';
import { startHttpTestApp } from './http-test-app';

// Origine du frontend (S29) : valeur par défaut de CORS_ORIGINS
const FRONT_ORIGIN = 'http://localhost:3000';

const mailStub = {
  sendEmailVerificationEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  sendAccountExistsEmail: jest.fn().mockResolvedValue(true),
};

@Controller('protected')
@UseGuards(JwtAuthGuard)
class ProtectedController {
  @Get()
  ping(@Req() req: { user: { id: string; sid: string; impersonatedBy?: string } }) {
    return { ok: true, user: req.user };
  }
}

/**
 * A3 + S7 : sessions révocables, jeton court, cookies httpOnly, déconnexion serveur,
 * rotation du jeton de rafraîchissement avec détection de réutilisation.
 */
describe('A3/S7 : cycle de vie des sessions (HTTP)', () => {
  const JWT_SECRET = 'test-secret-s7-sessions-0123456789abcdef0123';
  let app: INestApplication;
  let baseUrl: string;
  let prisma: FakePrisma;
  let redis: FakeRedisService;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    prisma = new FakePrisma();
    redis = new FakeRedisService();
    ({ app, baseUrl } = await startHttpTestApp({
      imports: [JwtModule.register({ global: true, secret: JWT_SECRET }), TokenModule],
      controllers: [AuthController, ProtectedController],
      providers: [
        AuthService,
        { provide: MailService, useValue: mailStub },
        JwtAuthGuard,
        SessionService, // SESSION
        { provide: PrismaService, useValue: prisma },
        { provide: FirebaseIdentityService, useValue: {} },
        { provide: RedisService, useValue: redis },
      ],
    }));
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  beforeEach(async () => {
    prisma.user.rows = [];
    prisma.refreshToken.rows = [];
    redis.store.clear();
    redis.ttls.length = 0;
    await prisma.user.create({
      data: {
        id: 'user-1',
        email: 'ada@corp.com',
        name: 'Ada',
        passwordHash: await hashPassword('MotDePasse!2026'),
      },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const cookieJar = (res: Response): Record<string, string> => {
    const jar: Record<string, string> = {};
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      jar[pair.slice(0, index)] = pair.slice(index + 1);
    }
    return jar;
  };
  const rawCookies = (res: Response) => res.headers.getSetCookie();
  const asHeader = (jar: Record<string, string>) =>
    Object.entries(jar)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

  const login = async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@corp.com', passwordRaw: 'MotDePasse!2026' }),
    });
    return { res, jar: cookieJar(res), body: await res.clone().json() };
  };
  const getProtected = (jar: Record<string, string>) =>
    fetch(`${baseUrl}/protected`, { headers: { Cookie: asHeader(jar), Origin: FRONT_ORIGIN } });
  const refresh = (jar: Record<string, string>) =>
    fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: asHeader(jar), Origin: FRONT_ORIGIN },
    });

  it('le jeton n’est plus renvoyé dans le corps, mais dans deux cookies httpOnly SameSite=Strict', async () => {
    const { res, body } = await login();
    expect(res.status).toBe(201);
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(body.user).toEqual(expect.objectContaining({ id: 'user-1', email: 'ada@corp.com' }));

    const cookies = rawCookies(res);
    const access = cookies.find((c) => c.startsWith('accessToken='));
    const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));
    expect(access).toBeDefined();
    expect(refreshCookie).toBeDefined();
    for (const c of [access, refreshCookie]) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=Strict/i);
    }
    expect(access).toMatch(/Max-Age=900/);
    expect(refreshCookie).toMatch(/Path=\/auth/);
    expect(refreshCookie).toMatch(/Max-Age=604800/);
  });

  it('le jeton d’accès dure 15 minutes au plus et porte sid et jti', async () => {
    const { jar } = await login();
    const payload = new JwtService({ secret: JWT_SECRET }).decode(jar.accessToken) as Record<
      string,
      unknown
    >;
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(900);
    expect(payload.sid).toEqual(expect.any(String));
    expect(payload.jti).toEqual(expect.any(String));
  });

  it('un jeton d’accès signé sans sid est rejeté (401)', async () => {
    const legacy = new JwtService({ secret: JWT_SECRET }).sign(
      { sub: 'user-1', typ: 'access' },
      { expiresIn: '7d' },
    );
    const res = await getProtected({ accessToken: legacy });
    expect(res.status).toBe(401);
  });

  it('login, logout, puis l’ancien cookie : 401 ; le refresh est lui aussi révoqué', async () => {
    const { jar } = await login();
    expect((await getProtected(jar)).status).toBe(200);

    const out = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: asHeader(jar), Origin: FRONT_ORIGIN },
    });
    expect(out.status).toBeLessThan(300);
    const cleared = rawCookies(out);
    expect(
      cleared.some(
        (c) =>
          /^accessToken=;/.test(c) || /accessToken=;|Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c),
      ),
    ).toBe(true);

    expect((await getProtected(jar)).status).toBe(401);
    expect((await refresh(jar)).status).toBe(401);
  });

  it('suspension en base : la session est coupée en moins de 60 s (cache Redis borné)', async () => {
    const { jar } = await login();
    expect((await getProtected(jar)).status).toBe(200);
    expect(redis.ttls.length).toBeGreaterThan(0);
    expect(redis.ttls.every((t) => (t.ttl ?? Infinity) <= 60)).toBe(true);

    await prisma.user.update({ where: { id: 'user-1' }, data: { isSuspended: true } });
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 61_000);
    expect((await getProtected(jar)).status).toBe(401);
  });

  it('un compte suspendu ne peut plus rafraîchir sa session', async () => {
    const { jar } = await login();
    await prisma.user.update({ where: { id: 'user-1' }, data: { isSuspended: true } });
    expect((await refresh(jar)).status).toBeGreaterThanOrEqual(401);
  });

  it('refresh : rotation, nouveaux cookies, ancien refresh inutilisable après la tolérance', async () => {
    const { jar } = await login();
    const first = await refresh(jar);
    expect(first.status).toBe(201);
    const next = cookieJar(first);
    expect(next.refreshToken).toBeDefined();
    expect(next.refreshToken).not.toBe(jar.refreshToken);
    expect(next.accessToken).toBeDefined();
    expect((await getProtected(next)).status).toBe(200);

    // Rejeu de l'ancien jeton alors que la rotation date de plus de 10 s : vol présumé
    const oldRow = prisma.refreshToken.rows.find(
      (r) => r.hashedToken === createHash('sha256').update(jar.refreshToken).digest('hex'),
    );
    oldRow!.rotatedAt = new Date(Date.now() - 60_000);
    const replay = await refresh(jar);
    expect(replay.status).toBe(401);

    // Toute la famille est révoquée : le nouveau refresh et le nouvel accès sont morts
    expect((await refresh(next)).status).toBe(401);
    redis.store.clear();
    expect((await getProtected(next)).status).toBe(401);
  });

  it('refresh : deux onglets simultanés (rejeu sous 10 s) ne révoquent pas la famille', async () => {
    const { jar } = await login();
    const first = await refresh(jar);
    const next = cookieJar(first);
    const second = await refresh(jar); // même ancien jeton, quelques ms plus tard
    expect(second.status).toBe(409);
    expect((await refresh(next)).status).toBe(201);
  });

  it('refresh : plafond absolu de 30 jours', async () => {
    const { jar } = await login();
    prisma.refreshToken.rows.forEach((r) => {
      r.authenticatedAt = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    });
    expect((await refresh(jar)).status).toBe(401);
  });

  it('refresh sans cookie : 401', async () => {
    expect((await refresh({})).status).toBe(401);
  });

  it('le jeton de rafraîchissement n’est jamais stocké en clair', async () => {
    const { jar } = await login();
    expect(prisma.refreshToken.rows.some((r) => r.hashedToken === jar.refreshToken)).toBe(false);
    expect(prisma.refreshToken.rows[0].hashedToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('révocation administrative : l’ancien jeton est rejeté immédiatement (cache invalidé)', async () => {
    const { jar } = await login();
    expect((await getProtected(jar)).status).toBe(200); // remplit le cache Redis
    const revoked = await app.get(SessionService).revokeAllForUser('user-1');
    expect(revoked).toBe(1);
    expect((await getProtected(jar)).status).toBe(401);
    expect((await refresh(jar)).status).toBe(401);
  });

  it('impersonation : session de 15 min sans refresh, qui porte impersonatedBy', async () => {
    const sessionService = app.get(SessionService);
    const issued = await sessionService.issue(
      { id: 'user-1', email: 'ada@corp.com', name: 'Ada' },
      { impersonatedBy: 'admin-9' },
    );
    expect(issued.refreshToken).toBeUndefined();
    const res = await getProtected({ accessToken: issued.accessToken });
    expect(res.status).toBe(200);
    expect((await res.json()).user.impersonatedBy).toBe('admin-9');
    const row = prisma.refreshToken.rows.find((r) => r.familyId === issued.sid)!;
    expect((row.expiresAt as Date).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('GET /auth/sessions liste les sessions du compte ; la session courante est marquée', async () => {
    const first = await login();
    await login(); // seconde session
    const res = await fetch(`${baseUrl}/auth/sessions`, {
      headers: { Cookie: asHeader(first.jar), Origin: FRONT_ORIGIN },
    });
    expect(res.status).toBe(200);
    const sessions = await res.json();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(sessions)).not.toMatch(/hashedToken|refreshToken/);
  });

  it('DELETE /auth/sessions/:sid révoque une autre session du compte, jamais celle d’autrui (404)', async () => {
    const mine = await login();
    const other = await login();
    const otherSid = (
      new JwtService({ secret: JWT_SECRET }).decode(other.jar.accessToken) as { sid: string }
    ).sid;

    await prisma.user.create({
      data: {
        id: 'user-2',
        email: 'eve@corp.com',
        passwordHash: await hashPassword('Autre!2026xx'),
      },
    });
    const eve = await app
      .get(SessionService)
      .issue({ id: 'user-2', email: 'eve@corp.com', name: null });

    const revokeOther = await fetch(`${baseUrl}/auth/sessions/${otherSid}`, {
      method: 'DELETE',
      headers: { Cookie: asHeader(mine.jar), Origin: FRONT_ORIGIN },
    });
    expect(revokeOther.status).toBe(204);
    redis.store.clear();
    expect((await getProtected(other.jar)).status).toBe(401);

    const attack = await fetch(`${baseUrl}/auth/sessions/${eve.sid}`, {
      method: 'DELETE',
      headers: { Cookie: asHeader(mine.jar), Origin: FRONT_ORIGIN },
    });
    expect(attack.status).toBe(404);
    expect((await getProtected({ accessToken: eve.accessToken })).status).toBe(200);
  });

  it('Redis indisponible : la vérification de session retombe sur la base (pas d’indisponibilité)', async () => {
    const { jar } = await login();
    redis.mode = 'reject';
    expect((await getProtected(jar)).status).toBe(200);
    redis.mode = 'ok';
  });

  // P6 / S27 : inscription générique, sans session ni cookie
  describe('inscription et récupération de compte (HTTP)', () => {
    const post = (path: string, body: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('POST /auth/register : 202, aucun cookie de session, réponse identique si l’adresse existe', async () => {
      const fresh = await post('/auth/register', {
        email: 'nouvelle@corp.com',
        passwordRaw: 'MotDePasse!2026',
        name: 'Nouvelle',
      });
      const duplicate = await post('/auth/register', {
        email: 'ada@corp.com',
        passwordRaw: 'MotDePasse!2026',
        name: 'Usurpateur',
      });
      expect(fresh.status).toBe(202);
      expect(duplicate.status).toBe(202);
      expect(fresh.headers.getSetCookie()).toHaveLength(0);
      expect(duplicate.headers.getSetCookie()).toHaveLength(0);
      expect(await duplicate.json()).toEqual(await fresh.json());
    });

    it('POST /auth/password/forgot : 202 identique pour une adresse inconnue', async () => {
      const known = await post('/auth/password/forgot', { email: 'ada@corp.com' });
      const unknown = await post('/auth/password/forgot', { email: 'inconnu@corp.com' });
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(await known.json()).toEqual(await unknown.json());
    });

    it('POST /auth/password/reset avec un mot de passe faible : 400', async () => {
      const res = await post('/auth/password/reset', { token: 'x', password: 'court' });
      expect(res.status).toBe(400);
    });

    it('POST /auth/email/verify avec un jeton inconnu : 400', async () => {
      const res = await post('/auth/email/verify', { token: 'inconnu' });
      expect(res.status).toBe(400);
    });
  });
});
