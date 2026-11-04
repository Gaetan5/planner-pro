import { RealtimeService } from '../../src/realtime/realtime.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { ScimAuthGuard } from '../../src/auth/scim/scim.guard';
import { ScimController } from '../../src/auth/scim/scim.controller';
import { ScimService } from '../../src/auth/scim/scim.service';
import { SessionService } from '../../src/auth/session.service';
import { TokenService } from '../../src/auth/token.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { STUB_SID, sessionServiceStub } from '../support/session.test-support';
import { FakePrisma } from './fake-prisma';
import { startHttpTestApp } from './http-test-app';

jest.setTimeout(30_000);

const SCIM_KEY = 'scim_live_test_key_0123456789';
const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';

/** S11 : DTO SCIM, expiration des clés, conformité (filtre, pagination, erreurs), domaine vérifié. */
describe('S11 : SCIM (HTTP)', () => {
  const JWT_SECRET = 'test-secret-s11-scim-0123456789abcdef0123456';
  let app: INestApplication;
  let baseUrl: string;
  let prisma: FakePrisma;
  let adminJwt: string;
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
      controllers: [ScimController],
      providers: [
        ScimService,
        { provide: RealtimeService, useValue: { refreshUserRooms: jest.fn() } },
        ScimAuthGuard,
        JwtAuthGuard,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SessionService,
          useFactory: (tokens: TokenService) => sessionServiceStub(tokens),
          inject: [TokenService],
        },
      ],
    }));
    adminJwt = app.get(TokenService).signAccessToken({ sub: 'admin-1', sid: STUB_SID });
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
    await prisma.user.create({ data: { id: 'admin-1', email: 'admin@acme.com', name: 'Admin' } });
    await prisma.membership.create({
      data: { workspaceId: 'ws-1', userId: 'admin-1', role: 'OWNER' },
    });
    await prisma.sSOConfiguration.create({
      data: {
        workspaceId: 'ws-1',
        domain: 'acme.com',
        verifiedDomain: 'acme.com',
        domainVerifiedAt: new Date(),
      },
    });
    await prisma.sCIMApiKey.create({
      data: {
        id: 'key-1',
        workspaceId: 'ws-1',
        tokenHash: createHash('sha256').update(SCIM_KEY).digest('hex'),
        workspace: { id: 'ws-1', name: 'ACME' },
      },
    });
  });

  const scim = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${SCIM_KEY}`, 'Content-Type': 'application/scim+json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const admin = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const provisioned = () => prisma.user.rows.filter((r) => r.id !== 'admin-1');
  const create = (extra: Record<string, unknown> = {}) =>
    scim('POST', '/scim/v2/Users', { userName: 'ada@acme.com', displayName: 'Ada', ...extra });

  describe('corps invalides', () => {
    it.each([
      ['sans identifiant', { displayName: 'Ada' }],
      ['userName non chaîne', { userName: 42 }],
      ['userName démesuré', { userName: `${'a'.repeat(300)}@acme.com` }],
      ['emails non tableau', { userName: 'ada@acme.com', emails: 'ada@acme.com' }],
      ['e-mail invalide', { userName: 'ada@acme.com', emails: [{ value: 'pas-un-email' }] }],
      ['active non booléen', { userName: 'ada@acme.com', active: 'oui' }],
      ['name non objet', { userName: 'ada@acme.com', name: 'Ada' }],
      ['schemas non tableau', { userName: 'ada@acme.com', schemas: 'x' }],
    ])('createUser %s : 400 au format SCIM, aucun compte', async (_label, body) => {
      const res = await scim('POST', '/scim/v2/Users', body);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.schemas).toEqual([SCIM_ERROR]);
      expect(json.status).toBe('400');
      expect(provisioned()).toHaveLength(0);
    });

    it('les attributs hors schéma envoyés par les IdP (groups, extension entreprise, meta) sont tolérés', async () => {
      const res = await create({
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        ],
        externalId: 'ext-1',
        groups: [],
        meta: { resourceType: 'User' },
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'R&D' },
      });
      expect(res.status).toBe(201);
    });

    it.each([
      ['Operations absent', { schemas: [] }],
      ['Operations non tableau', { Operations: 'x' }],
      ['op inconnue', { Operations: [{ op: 'explode', path: 'active', value: false }] }],
      ['op absente', { Operations: [{ path: 'active', value: false }] }],
    ])('PATCH %s : 400', async (_label, body) => {
      await prisma.user.create({ data: { id: 'u1', email: 'ada@acme.com', name: 'Ada' } });
      await prisma.membership.create({
        data: { workspaceId: 'ws-1', userId: 'u1', role: 'MEMBER' },
      });
      const res = await scim('PATCH', '/scim/v2/Users/u1', body);
      expect(res.status).toBe(400);
      expect((await res.json()).schemas).toEqual([SCIM_ERROR]);
    });

    it('PATCH : op en casse Entra (Replace) acceptée', async () => {
      await prisma.user.create({ data: { id: 'u1', email: 'ada@acme.com', name: 'Ada' } });
      await prisma.membership.create({
        data: { workspaceId: 'ws-1', userId: 'u1', role: 'MEMBER' },
      });
      const res = await scim('PATCH', '/scim/v2/Users/u1', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'Replace', path: 'active', value: 'True' }],
      });
      expect(res.status).toBe(200);
      expect((await res.json()).active).toBe(true);
    });
  });

  describe('domaine vérifié (condition de réactivation)', () => {
    it('adresse d’un autre domaine : 403 invalidValue, aucun compte', async () => {
      const res = await scim('POST', '/scim/v2/Users', { userName: 'x@autre.com' });
      expect(res.status).toBe(403);
      expect((await res.json()).scimType).toBe('invalidValue');
      expect(provisioned()).toHaveLength(0);
    });

    it('workspace sans domaine vérifié : 403', async () => {
      await prisma.sSOConfiguration.updateMany({
        where: {},
        data: { domainVerifiedAt: null, verifiedDomain: null },
      });
      expect((await create()).status).toBe(403);
      await prisma.sSOConfiguration.deleteMany({});
      expect((await create()).status).toBe(403);
      expect(provisioned()).toHaveLength(0);
    });

    it('adresse du domaine vérifié : 201', async () => {
      expect((await create()).status).toBe(201);
      expect(provisioned()).toHaveLength(1);
    });

    it('sous-domaine ou suffixe trompeur (acme.com.evil.io, evilacme.com) : 403', async () => {
      for (const userName of ['x@acme.com.evil.io', 'x@evilacme.com', 'x@sub.acme.com']) {
        expect((await scim('POST', '/scim/v2/Users', { userName })).status).toBe(403);
      }
    });
  });

  describe('PATCH sur emails (mutability)', () => {
    const seed = async () => {
      await prisma.user.create({ data: { id: 'u1', email: 'ada@acme.com', name: 'Ada' } });
      await prisma.membership.create({
        data: { workspaceId: 'ws-1', userId: 'u1', role: 'MEMBER' },
      });
    };
    const patch = (value: unknown, path = 'emails[type eq "work"].value') =>
      scim('PATCH', '/scim/v2/Users/u1', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path, value }],
      });

    it.each([
      ['chaîne', 'x@y.com'],
      ['tableau', [{ value: 'x@y.com' }]],
      ['objet', { value: 'x@y.com' }],
    ])('adresse différente (%s) : 400 mutability, adresse inchangée', async (_label, value) => {
      await seed();
      const res = await patch(value);
      expect(res.status).toBe(400);
      expect((await res.json()).scimType).toBe('mutability');
      expect(prisma.user.rows.find((r) => r.id === 'u1')?.email).toBe('ada@acme.com');
    });

    it('même adresse : 200', async () => {
      await seed();
      expect((await patch('ADA@acme.com')).status).toBe(200);
    });
  });

  describe('clés API SCIM', () => {
    it.each([
      ['sans nom', {}],
      ['nom vide', { name: '   ' }],
      ['nom trop long', { name: 'x'.repeat(101) }],
      ['nom non chaîne', { name: 42 }],
      ['expiresInDays démesuré', { name: 'k', expiresInDays: 9999 }],
      ['propriété inconnue', { name: 'k', admin: true }],
    ])('création %s : 400 (et non 500)', async (_label, body) => {
      const res = await admin('POST', '/workspaces/ws-1/scim/keys', body);
      expect(res.status).toBe(400);
      expect(prisma.sCIMApiKey.rows).toHaveLength(1);
    });

    it('expiration par défaut de 365 jours', async () => {
      const res = await admin('POST', '/workspaces/ws-1/scim/keys', { name: 'Entra' });
      expect(res.status).toBe(201);
      const row = prisma.sCIMApiKey.rows.find((r) => r.id !== 'key-1') as { expiresAt: Date };
      const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(364);
      expect(days).toBeLessThanOrEqual(365);
    });

    it('expiresInDays borné respecté', async () => {
      await admin('POST', '/workspaces/ws-1/scim/keys', { name: 'court', expiresInDays: 30 });
      const row = prisma.sCIMApiKey.rows.find((r) => r.name === 'court') as { expiresAt: Date };
      expect((row.expiresAt.getTime() - Date.now()) / 86_400_000).toBeLessThanOrEqual(30);
    });
  });

  describe('conformité : pagination, filtre, erreurs', () => {
    beforeEach(async () => {
      for (const [i, email] of ['ada@acme.com', 'bob@acme.com', 'cy@acme.com'].entries()) {
        await prisma.user.create({ data: { id: `u${i}`, email, name: email.split('@')[0] } });
        await prisma.membership.create({
          data: { workspaceId: 'ws-1', userId: `u${i}`, role: 'MEMBER' },
        });
      }
    });

    it.each(['count=abc', 'startIndex=abc', 'count=1.5', 'count=-1'])(
      'paramètre invalide (%s) : 400 au format SCIM',
      async (query) => {
        const res = await scim('GET', `/scim/v2/Users?${query}`);
        expect(res.status).toBe(400);
        expect((await res.json()).schemas).toEqual([SCIM_ERROR]);
      },
    );

    it('startIndex < 1 traité comme 1 ; count plafonné', async () => {
      const res = await scim('GET', '/scim/v2/Users?startIndex=0&count=100000');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.startIndex).toBe(1);
      expect(json.Resources.length).toBeLessThanOrEqual(100);
    });

    it('filtre userName eq "…" (insensible à la casse) : une seule ressource', async () => {
      const res = await scim(
        'GET',
        `/scim/v2/Users?filter=${encodeURIComponent('userName eq "BOB@acme.com"')}`,
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.totalResults).toBe(1);
      expect(json.Resources[0].userName).toBe('bob@acme.com');
    });

    it('filtre non pris en charge : 400 invalidFilter', async () => {
      const res = await scim(
        'GET',
        `/scim/v2/Users?filter=${encodeURIComponent('active eq true')}`,
      );
      expect(res.status).toBe(400);
      expect((await res.json()).scimType).toBe('invalidFilter');
    });

    it('ServiceProviderConfig : filter.supported cohérent avec le filtre implémenté', async () => {
      const res = await fetch(`${baseUrl}/scim/v2/ServiceProviderConfig`);
      expect((await res.json()).filter).toEqual({ supported: true, maxResults: 100 });
    });

    it('404 et 401 au format SCIM', async () => {
      const notFound = await scim('GET', '/scim/v2/Users/inconnu');
      expect(notFound.status).toBe(404);
      expect(await notFound.json()).toMatchObject({ schemas: [SCIM_ERROR], status: '404' });

      const unauthorized = await fetch(`${baseUrl}/scim/v2/Users`, {
        headers: { Authorization: 'Bearer mauvaise' },
      });
      expect(unauthorized.status).toBe(401);
      expect((await unauthorized.json()).schemas).toEqual([SCIM_ERROR]);
    });
  });
});
