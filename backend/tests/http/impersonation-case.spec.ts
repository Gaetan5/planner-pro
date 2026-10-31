import { INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../src/auth/firebase-identity.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { SessionService } from '../../src/auth/session.service';
import { TokenModule } from '../../src/auth/token.module';
import { MailService } from '../../src/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { FakePrisma } from './fake-prisma';
import { FakeRedisService } from './fake-redis';
import { startHttpTestApp } from './http-test-app';

/** S18.2 : le routage Express ignore la casse, le blocage doit tenir quand même (HTTP réel). */
describe('S18.2 : contournement par la casse du chemin (HTTP)', () => {
  const JWT_SECRET = 'test-secret-s18-case-0123456789abcdef0123456';
  let app: INestApplication;
  let baseUrl: string;
  let impersonation: string;
  let normal: string;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const prisma = new FakePrisma();
    await prisma.user.create({ data: { id: 'u-2', email: 'cible@corp.com', name: 'Cible' } });
    const redis = new FakeRedisService();
    ({ app, baseUrl } = await startHttpTestApp({
      imports: [JwtModule.register({ global: true, secret: JWT_SECRET }), TokenModule],
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: MailService, useValue: {} },
        JwtAuthGuard,
        SessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirebaseIdentityService, useValue: {} },
        { provide: RedisService, useValue: redis },
      ],
    }));
    const sessions = app.get(SessionService);
    const user = { id: 'u-2', email: 'cible@corp.com', name: 'Cible' };
    impersonation = (await sessions.issue(user, { impersonatedBy: 'admin-1' })).accessToken;
    normal = (await sessions.issue(user)).accessToken;
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  const call = (method: string, path: string, token: string) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });

  it.each([
    ['POST', '/auth/github/link'],
    ['POST', '/Auth/GitHub/Link'],
    ['POST', '/AUTH/MFA/setup'],
    ['POST', '/auth/MFA/disable'],
    ['DELETE', '/Auth/Sessions/abc'],
    ['POST', '/AUTH/FIREBASE/LINK'],
  ])('%s %s : 403 en impersonation', async (method, path) => {
    expect((await call(method, path, impersonation)).status).toBe(403);
  });

  it('hors impersonation, la même route passe le garde (400 de validation, pas 403)', async () => {
    expect((await call('POST', '/Auth/GitHub/Link', normal)).status).toBe(400);
  });
});
