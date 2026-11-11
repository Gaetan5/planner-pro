import { RealtimeService } from '../../src/realtime/realtime.service';
import { Controller, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { Public } from '../../src/auth/public.decorator';
import { ScimAuthGuard } from '../../src/auth/scim/scim.guard';
import { ScimController } from '../../src/auth/scim/scim.controller';
import { ScimService } from '../../src/auth/scim/scim.service';
import { FirestoreSyncService } from '../../src/firestore-sync/firestore-sync.service';
import { SessionService } from '../../src/auth/session.service';
import { TokenService } from '../../src/auth/token.service';
import {
  AppThrottlerGuard,
  resolveThrottlerTracker,
  THROTTLE_MESSAGE,
} from '../../src/common/app-throttler.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { STUB_SID, sessionServiceStub } from '../support/session.test-support';
import { FakePrisma } from './fake-prisma';
import { startHttpTestApp } from './http-test-app';

jest.setTimeout(30_000);

const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';

describe('S11-a : Débit SCIM par clé et non par IP', () => {
  const JWT_SECRET = 'test-secret-s11a-throttler-0123456789abcdef';
  let app: INestApplication;
  let baseUrl: string;
  let prisma: FakePrisma;
  const savedEnv = { ...process.env };

  const KEY_ORG_A = 'scim_key_org_a_secret_0123456789';
  const KEY_ORG_B = 'scim_key_org_b_secret_0123456789';

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.FEATURE_SCIM_ENABLED = 'true';
    prisma = new FakePrisma();

    ({ app, baseUrl } = await startHttpTestApp({
      imports: [
        JwtModule.register({ global: true, secret: JWT_SECRET }),
        ThrottlerModule.forRoot([
          {
            ttl: 60000,
            limit: 60,
          },
        ]),
      ],
      controllers: [ScimController],
      providers: [
        ScimService,
        { provide: FirestoreSyncService, useValue: { enqueue: jest.fn() } },
        { provide: RealtimeService, useValue: { refreshUserRooms: jest.fn() } },
        ScimAuthGuard,
        JwtAuthGuard,
        TokenService,
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: PrismaService, useValue: prisma },
        {
          provide: SessionService,
          useFactory: (tokens: TokenService) => sessionServiceStub(tokens),
          inject: [TokenService],
        },
      ],
    }));
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  beforeEach(async () => {
    prisma.user.rows = [];
    prisma.membership.rows = [];
    prisma.sSOConfiguration.rows = [];
    prisma.sCIMApiKey.rows = [];

    // Configuration des deux organisations avec domaines vérifiés
    await prisma.sSOConfiguration.create({
      data: {
        id: 'sso-org-a',
        workspaceId: 'ws-org-a',
        domain: 'orga.com',
        verifiedDomain: 'orga.com',
        domainVerifiedAt: new Date(),
        enabled: true,
        provider: 'OIDC_GOOGLE',
      },
    });

    await prisma.sSOConfiguration.create({
      data: {
        id: 'sso-org-b',
        workspaceId: 'ws-org-b',
        domain: 'orgb.com',
        verifiedDomain: 'orgb.com',
        domainVerifiedAt: new Date(),
        enabled: true,
        provider: 'OIDC_GOOGLE',
      },
    });

    // Clé SCIM Org A
    await prisma.sCIMApiKey.create({
      data: {
        id: 'key-id-a',
        workspaceId: 'ws-org-a',
        name: 'Clé Org A',
        tokenHash: createHash('sha256').update(KEY_ORG_A).digest('hex'),
        expiresAt: new Date(Date.now() + 86400_000),
        revokedAt: null,
        workspace: { id: 'ws-org-a', name: 'Workspace Org A' },
      },
    });

    // Clé SCIM Org B
    await prisma.sCIMApiKey.create({
      data: {
        id: 'key-id-b',
        workspaceId: 'ws-org-b',
        name: 'Clé Org B',
        tokenHash: createHash('sha256').update(KEY_ORG_B).digest('hex'),
        expiresAt: new Date(Date.now() + 86400_000),
        revokedAt: null,
        workspace: { id: 'ws-org-b', name: 'Workspace Org B' },
      },
    });
  });

  describe('resolveThrottlerTracker (unitaire, S11-b)', () => {
    it('une query string contenant /scim/v2 ne change pas le compteur : adresse IP', () => {
      const tracker = resolveThrottlerTracker({
        originalUrl: '/auth/login?x=/scim/v2',
        headers: { authorization: 'Bearer aleatoire' },
        ip: '198.51.100.25',
      });
      expect(tracker).toBe('198.51.100.25');
    });

    it('un chemin voisin (/api/scim/v2x) ne change pas le compteur : adresse IP', () => {
      const tracker = resolveThrottlerTracker({
        path: '/api/scim/v2x',
        originalUrl: '/api/scim/v2x',
        headers: { authorization: 'Bearer aleatoire' },
        ip: '198.51.100.25',
      });
      expect(tracker).toBe('198.51.100.25');
    });

    it('sur /scim/v2/*, un en-tête Authorization non authentifié ne remplace jamais l’IP', () => {
      const tracker = resolveThrottlerTracker({
        originalUrl: '/scim/v2/Users',
        path: '/scim/v2/Users',
        headers: { authorization: `Bearer ${KEY_ORG_A}` },
        ip: '198.51.100.25',
      });
      expect(tracker).toBe('198.51.100.25');
    });
  });

  describe('Isolation de débit entre deux organisations (HTTP réel)', () => {
    it('deux clés depuis la même IP ont des compteurs indépendants et la 301e donne 429 au format SCIM', async () => {
      // Émission de 300 requêtes pour Org A
      const reqsA: Promise<Response>[] = [];
      for (let i = 0; i < 300; i++) {
        reqsA.push(
          fetch(`${baseUrl}/scim/v2/Users`, {
            headers: { Authorization: `Bearer ${KEY_ORG_A}` },
          }),
        );
      }
      const responsesA = await Promise.all(reqsA);
      // Les 300 premières requêtes de Org A doivent toutes être acceptées (200)
      for (const res of responsesA) {
        expect(res.status).toBe(200);
      }

      // La 301e requête de Org A doit être rejetée en 429 Too Many Requests
      const res301A = await fetch(`${baseUrl}/scim/v2/Users`, {
        headers: { Authorization: `Bearer ${KEY_ORG_A}` },
      });
      expect(res301A.status).toBe(429);
      expect(res301A.headers.get('content-type')).toContain('application/scim+json');
      const body301A = await res301A.json();
      expect(body301A.schemas).toContain(SCIM_ERROR);
      expect(body301A.status).toBe('429');
      // r47-m2 : message français (format d'erreur SCIM conservé) et Retry-After
      expect(body301A.detail).toBe(THROTTLE_MESSAGE);
      expect(Number(res301A.headers.get('retry-after'))).toBeGreaterThan(0);

      // Org B, utilisant la même IP (127.0.0.1), NE DOIT PAS être bloquée (compteur indépendant)
      const resB = await fetch(`${baseUrl}/scim/v2/Users`, {
        headers: { Authorization: `Bearer ${KEY_ORG_B}` },
      });
      expect(resB.status).toBe(200);
      const bodyB = await resB.json();
      expect(bodyB.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    });
  });
});

@Controller('auth')
class StubAuthController {
  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login() {
    return { ok: true };
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  register() {
    return { ok: true };
  }
}

describe('S11-b : le limiteur de débit ne peut pas être contourné par l’URL ou l’en-tête Authorization', () => {
  const JWT_SECRET = 'test-secret-s11b-throttler-0123456789abcdef';
  let app: INestApplication;
  let baseUrl: string;
  let prisma: FakePrisma;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.FEATURE_SCIM_ENABLED = 'true';
    prisma = new FakePrisma();
    ({ app, baseUrl } = await startHttpTestApp({
      imports: [
        JwtModule.register({ global: true, secret: JWT_SECRET }),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
      ],
      controllers: [ScimController, StubAuthController],
      providers: [
        ScimService,
        { provide: FirestoreSyncService, useValue: { enqueue: jest.fn() } },
        { provide: RealtimeService, useValue: { refreshUserRooms: jest.fn() } },
        ScimAuthGuard,
        JwtAuthGuard,
        TokenService,
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: PrismaService, useValue: prisma },
        {
          provide: SessionService,
          useFactory: (tokens: TokenService) => sessionServiceStub(tokens),
          inject: [TokenService],
        },
      ],
    }));
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  beforeEach(() => {
    prisma.sCIMApiKey.rows = [];
  });

  it.each(['login', 'register'])(
    'POST /auth/%s?x=/scim/v2 avec un Authorization différent à chaque requête : 429 dès la 6e',
    async (route) => {
      const statuses: number[] = [];
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${baseUrl}/auth/${route}?x=/scim/v2`, {
          method: 'POST',
          headers: { Authorization: `Bearer aleatoire-${route}-${i}` },
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
      expect(statuses.slice(5)).toEqual([429, 429, 429, 429, 429]);
    },
  );

  it('le 429 du limiteur global est en français, avec Retry-After (r47-m2)', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await fetch(`${baseUrl}/auth/login`, { method: 'POST' });
    }
    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = await last?.json();
    expect(body.message).toBe(THROTTLE_MESSAGE);
    expect(JSON.stringify(body)).not.toContain('ThrottlerException');
  });

  it('GET /scim/v2/Users avec des clés invalides aléatoires depuis une même IP : 429 au format SCIM au-delà de la limite IP', async () => {
    const statuses = new Map<number, number>();
    const batch = 250;
    for (let sent = 0; sent < 3000; sent += batch) {
      const responses = await Promise.all(
        Array.from({ length: batch }, (_, i) =>
          fetch(`${baseUrl}/scim/v2/Users`, {
            headers: { Authorization: `Bearer cle-invalide-${sent + i}` },
          }),
        ),
      );
      for (const res of responses) statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
    }
    expect(statuses.get(401)).toBe(3000);
    const res = await fetch(`${baseUrl}/scim/v2/Users`, {
      headers: { Authorization: 'Bearer cle-invalide-finale' },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/scim+json');
    expect((await res.json()).schemas).toContain(SCIM_ERROR);
  });
});
