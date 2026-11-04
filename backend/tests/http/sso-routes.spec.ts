import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SsoController } from '../../src/auth/sso/sso.controller';
import { SsoService } from '../../src/auth/sso/sso.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { TokenService } from '../../src/auth/token.service';
import { SessionService } from '../../src/auth/session.service';
import { sessionServiceStub } from '../support/session.test-support';
import { startHttpTestApp } from './http-test-app';

/** S10 : contrat HTTP du flux SSO (le domaine et l'URL de retour ne viennent plus du client). */
describe('S10 : routes SSO (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const savedEnv = { ...process.env };
  const ssoService = {
    getAuthorizationUrl: jest
      .fn()
      .mockResolvedValue({ url: 'https://idp.example/authorize?x=1', state: 'sso_abc' }),
    handleCallback: jest.fn().mockResolvedValue({
      user: { id: 'u' },
      workspaceId: 'ws',
      session: { accessToken: 'a', accessMaxAgeSeconds: 900 },
    }),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-sso-routes-0123456789abc';
    process.env.FEATURE_SSO_ENABLED = 'true';
    ({ app, baseUrl } = await startHttpTestApp({
      controllers: [SsoController],
      providers: [
        { provide: SsoService, useValue: ssoService },
        { provide: JwtService, useValue: new JwtService({ secret: process.env.JWT_SECRET }) },
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
  beforeEach(() => jest.clearAllMocks());

  it('authorize : pose le cookie sso_flow (httpOnly, SameSite=Lax, Path=/auth/sso) = state', async () => {
    const res = await fetch(`${baseUrl}/auth/sso/authorize?domain=acme.com`);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain('idp.example');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sso_flow='));
    expect(cookie).toContain('sso_flow=sso_abc');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/auth\/sso/);
  });

  it('authorize : redirectUri fourni par le client refusé (400), le service n’est pas appelé', async () => {
    const res = await fetch(
      `${baseUrl}/auth/sso/authorize?domain=acme.com&redirectUri=https://evil.example`,
    );
    expect(res.status).toBe(400);
    expect(ssoService.getAuthorizationUrl).not.toHaveBeenCalled();
  });

  it('callback : transmet code, state et le cookie ; efface le cookie', async () => {
    const res = await fetch(`${baseUrl}/auth/sso/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'sso_flow=sso_abc' },
      body: JSON.stringify({ code: 'c', state: 'sso_abc' }),
    });
    expect(res.status).toBe(201);
    expect(ssoService.handleCallback).toHaveBeenCalledWith(
      'c',
      'sso_abc',
      'sso_abc',
      expect.anything(),
    );
    expect(res.headers.getSetCookie().some((c) => c.startsWith('sso_flow=;'))).toBe(true);
  });

  it.each([
    ['domain', { code: 'c', state: 's', domain: 'victime.com' }],
    ['redirectUri', { code: 'c', state: 's', redirectUri: 'https://evil.example' }],
    ['state manquant', { code: 'c' }],
  ])('callback : corps avec %s refusé (400), aucun échange', async (_label, body) => {
    const res = await fetch(`${baseUrl}/auth/sso/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect(ssoService.handleCallback).not.toHaveBeenCalled();
  });
});
