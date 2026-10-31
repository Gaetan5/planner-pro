import { Controller, Get, INestApplication, Post, Req, UseGuards } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../src/auth/firebase-identity.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { hashPassword } from '../../src/auth/encryption.util';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { TokenModule } from '../../src/auth/token.module';
import { SessionService } from '../../src/auth/session.service';
import { MailService } from '../../src/mail/mail.service';
import { FakePrisma } from './fake-prisma';
import { FakeRedisService } from './fake-redis';
import { startHttpTestApp } from './http-test-app';

jest.setTimeout(30_000);

@Controller('protected')
@UseGuards(JwtAuthGuard)
class ProtectedController {
  @Get()
  read() {
    return { ok: true };
  }
  @Post()
  write(@Req() req: { user: { id: string } }) {
    return { wrote: req.user.id };
  }
}

/** Réception libre : webhook GitHub et SCIM sont exemptés (authentifiés par signature ou clé). */
@Controller()
class ExemptedController {
  @Post('projects/webhooks/github')
  webhook() {
    return { ok: true };
  }
  @Post('scim/v2/Users')
  scim() {
    return { ok: true };
  }
}

/** S29 : CSRF depuis un sous-domaine du même site (les requêtes à cookie exigent une Origin autorisée). */
describe('S29 : contrôle d’Origin sur les méthodes à effet', () => {
  const JWT_SECRET = 'test-secret-s29-0123456789abcdef0123456789';
  const GOOD = 'https://app.boukarou-os.com';
  const EVIL = 'https://evil.boukarou-os.com';
  let app: INestApplication;
  let baseUrl: string;
  let cookie: string;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.CORS_ORIGINS = `${GOOD},https://admin.boukarou-os.com`;
    const prisma = new FakePrisma();
    await prisma.user.create({
      data: {
        id: 'user-1',
        email: 'ada@corp.com',
        name: 'Ada',
        passwordHash: await hashPassword('MotDePasse!2026'),
        emailVerifiedAt: new Date(),
      },
    });
    ({ app, baseUrl } = await startHttpTestApp({
      imports: [JwtModule.register({ global: true, secret: JWT_SECRET }), TokenModule],
      controllers: [AuthController, ProtectedController, ExemptedController],
      providers: [
        AuthService,
        { provide: MailService, useValue: {} },
        JwtAuthGuard,
        SessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirebaseIdentityService, useValue: {} },
        { provide: RedisService, useValue: new FakeRedisService() },
      ],
    }));
    // Connexion légitime (avec l'Origin du frontend)
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: GOOD },
      body: JSON.stringify({ email: 'ada@corp.com', passwordRaw: 'MotDePasse!2026' }),
    });
    expect(res.status).toBe(201);
    cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  const post = (path: string, headers: Record<string, string> = {}, withCookie = true) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { ...(withCookie ? { Cookie: cookie } : {}), ...headers },
    });

  it('cookie + Origin d’un sous-domaine voisin : 403, rien n’est exécuté', async () => {
    expect((await post('/protected', { Origin: EVIL })).status).toBe(403);
  });

  it('cookie + formulaire urlencoded depuis une origine étrangère : 403', async () => {
    const res = await post('/protected', {
      Origin: EVIL,
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(res.status).toBe(403);
  });

  it('cookie sans Origin ni Referer : 403', async () => {
    expect((await post('/protected')).status).toBe(403);
  });

  it('POST /auth/logout depuis une origine étrangère : 403 et la session reste valable', async () => {
    expect((await post('/auth/logout', { Origin: EVIL })).status).toBe(403);
    expect((await fetch(`${baseUrl}/protected`, { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it('Origin autorisée : accepté', async () => {
    expect((await post('/protected', { Origin: GOOD })).status).toBe(201);
    expect((await post('/protected', { Origin: 'https://admin.boukarou-os.com' })).status).toBe(
      201,
    );
  });

  it('Referer autorisé à défaut d’Origin : accepté ; Referer étranger : 403', async () => {
    expect((await post('/protected', { Referer: `${GOOD}/dashboard` })).status).toBe(201);
    expect((await post('/protected', { Referer: `${EVIL}/page` })).status).toBe(403);
  });

  it('Origin "null" (iframe sandbox, redirection) : 403', async () => {
    expect((await post('/protected', { Origin: 'null' })).status).toBe(403);
  });

  it('les lectures (GET) ne sont pas concernées', async () => {
    const res = await fetch(`${baseUrl}/protected`, { headers: { Cookie: cookie, Origin: EVIL } });
    expect(res.status).toBe(200);
  });

  it('sans cookie de session (Bearer, webhook, SCIM) : aucun contrôle d’Origin', async () => {
    expect((await post('/auth/password/forgot', { Origin: EVIL }, false)).status).not.toBe(403);
    expect((await post('/projects/webhooks/github', { Origin: EVIL }, false)).status).toBe(201);
    expect((await post('/scim/v2/Users', { Origin: EVIL }, false)).status).toBe(201);
  });

  it('les exemptions webhook et SCIM tiennent même si un cookie est présent', async () => {
    expect((await post('/projects/webhooks/github')).status).toBe(201);
    expect((await post('/scim/v2/Users')).status).toBe(201);
  });
});
