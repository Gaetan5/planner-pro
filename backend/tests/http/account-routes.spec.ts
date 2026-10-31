import { INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../src/auth/firebase-identity.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { TokenModule } from '../../src/auth/token.module';
import { SessionService } from '../../src/auth/session.service';
import { MailService } from '../../src/mail/mail.service';
import { FakePrisma } from './fake-prisma';
import { FakeRedisService } from './fake-redis';
import { startHttpTestApp } from './http-test-app';

jest.setTimeout(30_000);

const mail = {
  sendEmailVerificationEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  sendAccountExistsEmail: jest.fn().mockResolvedValue(true),
};

/** P6 + S27 : contrat HTTP des parcours de compte (202 générique, aucune session à l'inscription). */
describe('P6/S27 : routes de compte (HTTP)', () => {
  const JWT_SECRET = 'test-secret-p6-http-0123456789abcdef0123456';
  let app: INestApplication;
  let baseUrl: string;
  let prisma: FakePrisma;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    prisma = new FakePrisma();
    ({ app, baseUrl } = await startHttpTestApp({
      imports: [JwtModule.register({ global: true, secret: JWT_SECRET }), TokenModule],
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: MailService, useValue: mail },
        JwtAuthGuard,
        SessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirebaseIdentityService, useValue: {} },
        { provide: RedisService, useValue: new FakeRedisService() },
      ],
    }));
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  beforeEach(() => {
    prisma.user.rows = [];
    prisma.authToken.rows = [];
    prisma.refreshToken.rows = [];
    jest.clearAllMocks();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const register = (email: string) =>
    post('/auth/register', { email, passwordRaw: 'MotDePasse!2026', name: 'Ada' });

  it('register : 202, aucun cookie de session, aucun jeton dans le corps', async () => {
    const res = await register('ada@corp.com');
    expect(res.status).toBe(202);
    expect(res.headers.getSetCookie()).toEqual([]);
    const body = await res.json();
    expect(body.accessToken).toBeUndefined();
    expect(body.user).toBeUndefined();
  });

  it('register : réponse (statut et corps) identique pour une adresse déjà utilisée (S27)', async () => {
    const first = await register('ada@corp.com');
    const firstBody = await first.json();
    const duplicate = await register('ada@corp.com');
    expect(duplicate.status).toBe(first.status);
    expect(await duplicate.json()).toEqual(firstBody);
    expect(prisma.user.rows).toHaveLength(1);
  });

  it('login avant vérification : 403 ; après vérification par le lien : connexion possible', async () => {
    await register('ada@corp.com');
    const credentials = { email: 'ada@corp.com', passwordRaw: 'MotDePasse!2026' };
    expect((await post('/auth/login', credentials)).status).toBe(403);

    const raw = mail.sendEmailVerificationEmail.mock.calls[0][1] as string;
    expect((await post('/auth/email/verify', { token: raw })).status).toBe(200);
    expect((await post('/auth/email/verify', { token: raw })).status).toBe(400);
    expect((await post('/auth/login', credentials)).status).toBe(201);
  });

  it('forgot : 202 identique pour une adresse inconnue ; reset avec un jeton inconnu : 400', async () => {
    const unknown = await post('/auth/password/forgot', { email: 'inconnu@corp.com' });
    expect(unknown.status).toBe(202);
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(
      (await post('/auth/password/reset', { token: 'x', password: 'NouveauMdp!2027' })).status,
    ).toBe(400);
  });

  it('reset : un mot de passe faible est refusé par le DTO (400)', async () => {
    expect((await post('/auth/password/reset', { token: 'x', password: 'court' })).status).toBe(
      400,
    );
  });
});
