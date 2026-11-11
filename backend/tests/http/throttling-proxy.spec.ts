import { Controller, Get, INestApplication, Post, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import { PolicyService } from '../../src/authz/policy.service';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../src/auth/firebase-identity.service';
import * as encryptionUtil from '../../src/auth/encryption.util';
import { hashPassword } from '../../src/auth/encryption.util';
import { SessionService } from '../../src/auth/session.service';
import { TokenModule } from '../../src/auth/token.module';
import { AppThrottlerGuard } from '../../src/common/app-throttler.guard';
import { RedisThrottlerStorage } from '../../src/common/redis-throttler.storage';
import { MailService } from '../../src/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { InvitationsController } from '../../src/projects/invitations.controller';
import { InvitationsService } from '../../src/projects/invitations.service';
import { RedisService } from '../../src/redis/redis.service';
import { FakePrisma } from './fake-prisma';
import { FakeRedisService } from './fake-redis';
import { startHttpTestApp } from './http-test-app';

jest.setTimeout(30_000);

@Controller('probe')
class ProbeController {
  @Get('strict')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  strict(@Req() req: { ip: string }) {
    return { ip: req.ip };
  }

  @Get('global')
  global(@Req() req: { ip: string }) {
    return { ip: req.ip };
  }

  @Post('ok')
  ok() {
    return { ok: true };
  }
}

const mailStub = {
  sendEmailVerificationEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  sendAccountExistsEmail: jest.fn().mockResolvedValue(true),
};

/**
 * S24 : adresse IP réelle derrière le reverse proxy (`trust proxy`), limiteur global et limites
 * par compte. Application Nest réelle, compteurs dans un faux Redis partagé.
 */
describe('S24 : limitation de débit derrière un reverse proxy', () => {
  const JWT_SECRET = 'test-secret-s24-0123456789abcdef0123456789';
  const PASSWORD = 'MotDePasse!2026';
  const savedEnv = { ...process.env };
  const redis = new FakeRedisService();
  const prisma = new FakePrisma();
  const invitationsService = { checkInvitation: jest.fn().mockResolvedValue({ valid: true }) };

  async function start(trustProxyHops: number) {
    return startHttpTestApp(
      {
        imports: [
          JwtModule.register({ global: true, secret: JWT_SECRET }),
          TokenModule,
          ThrottlerModule.forRoot({
            throttlers: [{ ttl: 60000, limit: 60 }],
            storage: new RedisThrottlerStorage(redis),
          }),
        ],
        controllers: [ProbeController, AuthController, InvitationsController],
        providers: [
          { provide: APP_GUARD, useClass: AppThrottlerGuard },
          AuthService,
          SessionService,
          { provide: MailService, useValue: mailStub },
          { provide: PolicyService, useValue: {} },
          { provide: PrismaService, useValue: prisma },
          { provide: FirebaseIdentityService, useValue: {} },
          { provide: RedisService, useValue: redis },
          { provide: InvitationsService, useValue: invitationsService },
        ],
      },
      { trustProxyHops },
    );
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await prisma.user.create({
      data: {
        id: 'user-1',
        email: 'victime@corp.com',
        name: 'Victime',
        passwordHash: await hashPassword(PASSWORD),
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.user.create({
      data: {
        id: 'user-2',
        email: 'autre@corp.com',
        name: 'Autre',
        passwordHash: await hashPassword(PASSWORD),
        emailVerifiedAt: new Date(),
      },
    });
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  beforeEach(() => {
    redis.store.clear();
    redis.mode = 'ok';
  });

  describe('trust proxy = 1 (un reverse proxy devant le backend)', () => {
    let app: INestApplication;
    let baseUrl: string;
    beforeAll(async () => {
      ({ app, baseUrl } = await start(1));
    });
    afterAll(() => app.close());

    const get = (path: string, forwardedFor?: string) =>
      fetch(`${baseUrl}${path}`, {
        headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {},
      });

    it('req.ip est l’adresse transmise par le proxy, pas celle du proxy', async () => {
      const res = await get('/probe/global', '203.0.113.7');
      expect((await res.json()).ip).toBe('203.0.113.7');
    });

    it('deux clients distincts ont des compteurs distincts (pas de déni de service global)', async () => {
      const a: number[] = [];
      for (let i = 0; i < 6; i++) a.push((await get('/probe/strict', '198.51.100.1')).status);
      expect(a).toEqual([200, 200, 200, 200, 200, 429]);
      // Un autre client n'est pas touché par l'épuisement du premier
      expect((await get('/probe/strict', '198.51.100.2')).status).toBe(200);
    });

    it('une adresse falsifiée à gauche de celle du proxy est ignorée : le compteur reste celui du client réel', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await get('/probe/strict', `10.0.0.${i}, 192.0.2.50`)).status);
      }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    });

    it('limiteur global : 60 requêtes par minute et par client, la 61e est refusée', async () => {
      let last = 0;
      for (let i = 0; i < 61; i++) last = (await get('/probe/global', '192.0.2.99')).status;
      expect(last).toBe(429);
      expect((await get('/probe/global', '192.0.2.100')).status).toBe(200);
    });

    it('les compteurs sont dans Redis : un autre processus partageant Redis voit les mêmes', async () => {
      for (let i = 0; i < 5; i++) await get('/probe/strict', '198.51.100.9');
      const keys = [...redis.store.keys()].filter((key) => key.startsWith('throttle:'));
      expect(keys.length).toBeGreaterThan(0);
      // Aucune adresse en clair dans les clés
      expect(keys.some((key) => key.includes('198.51.100.9'))).toBe(false);
    });

    describe('connexion : limite par compte', () => {
      const login = (email: string, passwordRaw: string, forwardedFor: string) =>
        fetch(`${baseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
          body: JSON.stringify({ email, passwordRaw }),
        });

      it('six tentatives sur le même e-mail depuis six adresses : la sixième renvoie 429', async () => {
        const statuses: number[] = [];
        for (let i = 1; i <= 6; i++) {
          statuses.push(
            (await login('victime@corp.com', 'MauvaisMotDePasse!1', `203.0.113.${i}`)).status,
          );
        }
        expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
      });

      it('le compte verrouillé refuse aussi le bon mot de passe (pas de force brute à travers la limite)', async () => {
        for (let i = 1; i <= 5; i++)
          await login('victime@corp.com', 'MauvaisMotDePasse!1', `203.0.113.${i}`);
        const res = await login('victime@corp.com', PASSWORD, '203.0.113.50');
        expect(res.status).toBe(429);
      });

      it('un autre compte n’est pas affecté, ni le même compte une fois la minute écoulée', async () => {
        for (let i = 1; i <= 5; i++)
          await login('victime@corp.com', 'MauvaisMotDePasse!1', `203.0.113.${i}`);
        expect((await login('autre@corp.com', PASSWORD, '203.0.113.60')).status).toBe(201);
        redis.advance(61_000);
        expect((await login('victime@corp.com', PASSWORD, '203.0.113.61')).status).toBe(201);
      });

      it('30 tentatives simultanées depuis 30 adresses : au plus 5 atteignent la vérification du mot de passe (r44-m2)', async () => {
        const verify = jest.spyOn(encryptionUtil, 'verifyPassword');
        try {
          const responses = await Promise.all(
            Array.from({ length: 30 }, (_v, i) =>
              login('victime@corp.com', 'MauvaisMotDePasse!1', `198.18.0.${i + 1}`),
            ),
          );
          const statuses = responses.map((r) => r.status);
          expect(statuses.filter((status) => status === 401)).toHaveLength(5);
          expect(statuses.filter((status) => status === 429)).toHaveLength(25);
          expect(verify.mock.calls.length).toBe(5);
        } finally {
          verify.mockRestore();
        }
      });

      it('un compte inexistant est limité de la même façon (aucun oracle d’existence)', async () => {
        const statuses: number[] = [];
        for (let i = 1; i <= 6; i++) {
          statuses.push(
            (await login('fantome@corp.com', 'MauvaisMotDePasse!1', `203.0.113.${i}`)).status,
          );
        }
        expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
      });

      it('une connexion réussie remet le compteur du compte à zéro', async () => {
        for (let i = 1; i <= 3; i++)
          await login('victime@corp.com', 'MauvaisMotDePasse!1', `203.0.113.${i}`);
        expect((await login('victime@corp.com', PASSWORD, '203.0.113.10')).status).toBe(201);
        const statuses: number[] = [];
        for (let i = 11; i <= 15; i++) {
          statuses.push(
            (await login('victime@corp.com', 'MauvaisMotDePasse!1', `203.0.113.${i}`)).status,
          );
        }
        expect(statuses).toEqual([401, 401, 401, 401, 401]);
      });

      it('la limite par IP du contrôleur s’applique toujours : six comptes depuis la même adresse', async () => {
        const statuses: number[] = [];
        for (let i = 0; i < 6; i++) {
          statuses.push(
            (await login(`inconnu${i}@corp.com`, 'MauvaisMotDePasse!1', '203.0.113.200')).status,
          );
        }
        expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
      });
    });

    describe('routes publiques d’invitation (r35)', () => {
      const check = (forwardedFor: string) =>
        fetch(`${baseUrl}/projects/invitations/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
          body: JSON.stringify({ token: 'a'.repeat(64) }),
        });

      it('vérification de jeton : 20 par minute et par client, la 21e est refusée (défaut global : 60)', async () => {
        const statuses: number[] = [];
        for (let i = 0; i < 21; i++) statuses.push((await check('198.51.100.77')).status);
        expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
        expect(statuses[20]).toBe(429);
        expect((await check('198.51.100.78')).status).toBe(200);
      });
    });
  });

  describe('trust proxy = 0 (aucun proxy : X-Forwarded-For n’est pas fiable)', () => {
    let app: INestApplication;
    let baseUrl: string;
    beforeAll(async () => {
      ({ app, baseUrl } = await start(0));
    });
    afterAll(() => app.close());

    it('l’en-tête est ignoré : un client ne change pas de compteur en le faisant varier', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`${baseUrl}/probe/strict`, {
          headers: { 'X-Forwarded-For': `203.0.113.${i}` },
        });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    });

    it('req.ip est l’adresse de la connexion', async () => {
      const res = await fetch(`${baseUrl}/probe/global`, {
        headers: { 'X-Forwarded-For': '203.0.113.7' },
      });
      expect((await res.json()).ip).toMatch(/127\.0\.0\.1$/);
    });
  });
});
