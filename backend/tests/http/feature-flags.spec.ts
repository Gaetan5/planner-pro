import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SsoController } from '../../src/auth/sso/sso.controller';
import { SsoService } from '../../src/auth/sso/sso.service';
import { ScimController } from '../../src/auth/scim/scim.controller';
import { ScimService } from '../../src/auth/scim/scim.service';
import { ScimAuthGuard } from '../../src/auth/scim/scim.guard';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';
import { TokenService } from '../../src/auth/token.service';
import { SessionService } from '../../src/auth/session.service';
import { sessionServiceStub } from '../support/session.test-support';
import { startHttpTestApp } from './http-test-app';

/**
 * P3 : interrupteurs FEATURE_SSO_ENABLED / FEATURE_SCIM_ENABLED.
 * Drapeaux absents : toutes les routes SSO et SCIM répondent 404 avant toute authentification
 * ou tout appel de service.
 */
describe('P3 : drapeaux de fonctionnalités SSO / SCIM (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const ssoService = {
    discover: jest.fn().mockResolvedValue({ ssoAvailable: false }),
    handleCallback: jest.fn(),
    getAuthorizationUrl: jest.fn(),
  };
  const scimService = {
    listUsers: jest.fn(),
    createApiKey: jest.fn(),
    getServiceProviderConfig: jest.fn().mockReturnValue({ schemas: [] }),
  };
  const prisma = { sCIMApiKey: { findUnique: jest.fn(), update: jest.fn() } };
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-feature-flags-0123456789';
    ({ app, baseUrl } = await startHttpTestApp({
      controllers: [SsoController, ScimController, AppController],
      providers: [
        AppService,
        { provide: SsoService, useValue: ssoService },
        { provide: ScimService, useValue: scimService },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: new JwtService({ secret: process.env.JWT_SECRET }) },
        ScimAuthGuard,
        JwtAuthGuard,
        TokenService,
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
    jest.clearAllMocks();
    delete process.env.FEATURE_SSO_ENABLED;
    delete process.env.FEATURE_SCIM_ENABLED;
    delete process.env.FEATURE_IMPERSONATION_ENABLED;
  });

  const post = (path: string, body: unknown = {}) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it.each([
    ['POST', '/auth/sso/callback', { code: 'x', domain: 'acme.com' }],
    ['POST', '/auth/sso/discover', { email: 'a@acme.com' }],
    ['GET', '/auth/sso/authorize?domain=acme.com', undefined],
    ['GET', '/workspaces/ws-1/sso', undefined],
  ])('SSO désactivé par défaut : %s %s renvoie 404', async (method, path, body) => {
    const res = method === 'POST' ? await post(path, body) : await fetch(`${baseUrl}${path}`);
    expect(res.status).toBe(404);
    expect(ssoService.handleCallback).not.toHaveBeenCalled();
    expect(ssoService.discover).not.toHaveBeenCalled();
    expect(ssoService.getAuthorizationUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/scim/v2/Users'],
    ['GET', '/scim/v2/ServiceProviderConfig'],
    ['POST', '/workspaces/ws-1/scim/keys'],
    ['GET', '/workspaces/ws-1/scim/keys'],
    ['DELETE', '/workspaces/ws-1/scim/keys/key-1'],
  ])('SCIM désactivé par défaut : %s %s renvoie 404', async (method, path) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer scim_live_x' },
      body: method === 'POST' ? JSON.stringify({ name: 'k' }) : undefined,
    });
    expect(res.status).toBe(404);
    expect(prisma.sCIMApiKey.findUnique).not.toHaveBeenCalled();
    expect(scimService.listUsers).not.toHaveBeenCalled();
    expect(scimService.createApiKey).not.toHaveBeenCalled();
  });

  it("une valeur autre que 'true' laisse les fonctionnalités désactivées", async () => {
    process.env.FEATURE_SSO_ENABLED = '1';
    process.env.FEATURE_SCIM_ENABLED = 'yes';
    expect((await post('/auth/sso/discover', { email: 'a@acme.com' })).status).toBe(404);
    expect((await fetch(`${baseUrl}/scim/v2/ServiceProviderConfig`)).status).toBe(404);
  });

  it('drapeaux à true : les routes sont de nouveau servies', async () => {
    process.env.FEATURE_SSO_ENABLED = 'true';
    process.env.FEATURE_SCIM_ENABLED = 'true';
    const discover = await post('/auth/sso/discover', { email: 'a@acme.com' });
    expect(discover.status).toBe(201);
    expect(ssoService.discover).toHaveBeenCalledWith('a@acme.com');
    const config = await fetch(`${baseUrl}/scim/v2/ServiceProviderConfig`);
    expect(config.status).toBe(200);
    // Les routes de gestion restent soumises à l'authentification
    const keys = await post('/workspaces/ws-1/scim/keys', { name: 'k' });
    expect(keys.status).toBe(401);
  });

  it("GET /features expose l'état des drapeaux au frontend", async () => {
    let res = await fetch(`${baseUrl}/features`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sso: false, scim: false, impersonation: false });

    process.env.FEATURE_SSO_ENABLED = 'true';
    res = await fetch(`${baseUrl}/features`);
    expect(await res.json()).toEqual({ sso: true, scim: false, impersonation: false });
  });
});
