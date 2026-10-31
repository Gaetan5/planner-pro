import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../src/auth/firebase-identity.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { hashPassword } from '../../src/auth/encryption.util';
import { generateTotpCode, generateTotpSecret } from '../../src/auth/totp.util';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { TokenModule } from '../../src/auth/token.module';
import { SessionService } from '../../src/auth/session.service';
import { MailService } from '../../src/mail/mail.service';
import { FakePrisma } from './fake-prisma';
import { FakeRedisService } from './fake-redis';
import { startHttpTestApp } from './http-test-app';

/**
 * Le délai Redis est de 2 s (borne le parcours) ; la marge de 1 s absorbe la vérification Argon2 du
 * mot de passe et la charge des exécutions parallèles de la suite.
 */
const MAX_RESPONSE_MS = 3000;

const mailStub = {
  sendEmailVerificationEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  sendAccountExistsEmail: jest.fn().mockResolvedValue(true),
};

@Controller('protected')
@UseGuards(JwtAuthGuard)
class ProtectedController {
  @Get()
  ping() {
    return { ok: true };
  }
}

/**
 * S3 : le ticket MFA ne doit jamais servir de jeton d'accès, et ne sert qu'une fois.
 */
describe('S3 : séparation ticket MFA / jeton d’accès (HTTP)', () => {
  const JWT_SECRET = 'test-secret-s3-0123456789abcdef0123456789';
  let app: INestApplication;
  let baseUrl: string;
  let mfaSecret: string;
  let redis: FakeRedisService;
  const savedEnv = { ...process.env };

  const prisma = new FakePrisma();

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    mfaSecret = generateTotpSecret();
    await prisma.user.create({
      data: {
        id: 'user-mfa',
        email: 'victime@corp.com',
        name: 'Victime',
        passwordHash: await hashPassword('MotDePasse!2026'),
        mfaEnabled: true,
        mfaSecret,
      },
    });
    redis = new FakeRedisService();
    ({ app, baseUrl } = await startHttpTestApp({
      imports: [JwtModule.register({ global: true, secret: JWT_SECRET }), TokenModule],
      controllers: [AuthController, ProtectedController],
      providers: [
        AuthService,
        { provide: MailService, useValue: mailStub },
        JwtAuthGuard,
        SessionService,
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

  beforeEach(() => {
    redis.store.clear();
    redis.mode = 'ok';
  });

  const postJson = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const login = async (): Promise<string> => {
    const res = await postJson('/auth/login', {
      email: 'victime@corp.com',
      passwordRaw: 'MotDePasse!2026',
    });
    const body = await res.json();
    expect(body.mfaRequired).toBe(true);
    expect(body.accessToken).toBeUndefined();
    return body.mfaTicket;
  };

  const getProtected = (token: string) =>
    fetch(`${baseUrl}/protected`, { headers: { Authorization: `Bearer ${token}` } });

  const wrongCode = (): string => {
    const now = Date.now();
    const valid = new Set([-30000, 0, 30000].map((d) => generateTotpCode(mfaSecret, now + d)));
    for (let i = 0; ; i++) {
      const candidate = String(i).padStart(6, '0');
      if (!valid.has(candidate)) return candidate;
    }
  };

  it('le ticket MFA présenté en Bearer sur une route protégée est rejeté (401)', async () => {
    const ticket = await login();
    const res = await getProtected(ticket);
    expect(res.status).toBe(401);
  });

  it('le ticket MFA présenté en cookie accessToken est rejeté (401)', async () => {
    const ticket = await login();
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Cookie: `accessToken=${ticket}` },
    });
    expect(res.status).toBe(401);
  });

  it('un jeton signé avec le bon secret mais sans claim typ est rejeté (401)', async () => {
    const legacy = new JwtService({ secret: JWT_SECRET }).sign({
      sub: 'user-mfa',
      email: 'victime@corp.com',
    });
    expect((await getProtected(legacy)).status).toBe(401);
  });

  it('un ticket au format historique ({sub, mfaPending}) signé avec JWT_SECRET est refusé au challenge', async () => {
    const legacyTicket = new JwtService({ secret: JWT_SECRET }).sign(
      { sub: 'user-mfa', mfaPending: true },
      { expiresIn: '5m' },
    );
    const res = await postJson('/auth/mfa/challenge', {
      mfaTicket: legacyTicket,
      code: generateTotpCode(mfaSecret),
    });
    expect(res.status).toBe(401);
  });

  it('challenge réussi : le jeton d’accès émis fonctionne, et le ticket ne peut pas être rejoué', async () => {
    const ticket = await login();
    const first = await postJson('/auth/mfa/challenge', {
      mfaTicket: ticket,
      code: generateTotpCode(mfaSecret),
    });
    expect(first.status).toBe(201);
    const accessToken = first.headers
      .getSetCookie()
      .find((c) => c.startsWith('accessToken='))!
      .split(';')[0]
      .slice('accessToken='.length);
    expect((await first.clone().json()).accessToken).toBeUndefined();
    expect((await getProtected(accessToken)).status).toBe(200);

    const replay = await postJson('/auth/mfa/challenge', {
      mfaTicket: ticket,
      code: generateTotpCode(mfaSecret),
    });
    expect(replay.status).toBe(401);
  });

  it('après 5 codes faux, le 6e essai est refusé même avec un code valide', async () => {
    const ticket = await login();
    for (let i = 0; i < 5; i++) {
      const res = await postJson('/auth/mfa/challenge', { mfaTicket: ticket, code: wrongCode() });
      expect(res.status).toBe(401);
    }
    const sixth = await postJson('/auth/mfa/challenge', {
      mfaTicket: ticket,
      code: generateTotpCode(mfaSecret),
    });
    expect(sixth.status).toBe(401);
  });

  // S3 (r2) : Redis indisponible : 503 explicite et borné, jamais de jeton ni de ticket
  describe('Redis indisponible dans le parcours MFA', () => {
    const timed = async (request: () => Promise<Response>) => {
      const started = Date.now();
      const res = await request();
      return { res, elapsed: Date.now() - started, body: await res.json() };
    };

    it.each(['reject', 'hang'] as const)(
      'POST /auth/login (compte MFA), Redis en mode %s : 503 en moins de 2,5 s, sans ticket',
      async (mode) => {
        redis.mode = mode;
        const { res, elapsed, body } = await timed(() =>
          postJson('/auth/login', { email: 'victime@corp.com', passwordRaw: 'MotDePasse!2026' }),
        );
        expect(res.status).toBe(503);
        expect(elapsed).toBeLessThan(MAX_RESPONSE_MS);
        expect(body.mfaTicket).toBeUndefined();
        expect(body.accessToken).toBeUndefined();
      },
    );

    it.each(['reject', 'hang'] as const)(
      'POST /auth/mfa/challenge, Redis en mode %s : 503 en moins de 2,5 s, sans jeton',
      async (mode) => {
        const ticket = await login();
        redis.mode = mode;
        const { res, elapsed, body } = await timed(() =>
          postJson('/auth/mfa/challenge', { mfaTicket: ticket, code: generateTotpCode(mfaSecret) }),
        );
        expect(res.status).toBe(503);
        expect(elapsed).toBeLessThan(MAX_RESPONSE_MS);
        expect(body.accessToken).toBeUndefined();
        expect(res.headers.get('set-cookie')).toBeNull();
      },
    );
  });

  // S6 : corps validés (DTO) sur le challenge
  describe('validation du corps du challenge', () => {
    it.each([
      ['code non numérique', { mfaTicket: 't', code: 'abcdef' }],
      ['code de 5 chiffres', { mfaTicket: 't', code: '12345' }],
      ['champ inattendu', { mfaTicket: 't', code: '123456', admin: true }],
      ['ticket manquant', { code: '123456' }],
    ])('%s : 400 avant toute consommation du ticket', async (_label, body) => {
      const res = await postJson('/auth/mfa/challenge', body);
      expect(res.status).toBe(400);
    });
  });
});
