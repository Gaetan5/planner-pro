import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from '../../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../../src/auth/firebase-identity.service';
import { MailService } from '../../../src/mail/mail.service';
import { SessionService } from '../../../src/auth/session.service';
import { TokenService } from '../../../src/auth/token.service';
import { hashPassword } from '../../../src/auth/encryption.util';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';
import { createGithubOAuthState } from '../../../src/auth/github-oauth-state';
import { FakePrisma } from '../../http/fake-prisma';
import { FakeRedisService } from '../../http/fake-redis';

/**
 * S8 : la matrice {mot de passe, GitHub, Firebase, SSO} x {suspendu, MFA actif, enforceSSO} donne
 * partout le même comportement, parce que tous les chemins passent par AuthService.completeLogin.
 */
describe('S8 : politique de connexion uniforme', () => {
  const PASSWORD = 'MotDePasse!2026';
  const savedEnv = { ...process.env };
  let service: AuthService;
  let prisma: FakePrisma;
  let redis: FakeRedisService;
  const firebase = { verifyIdToken: jest.fn() };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret-s8-policy-0123456789abcdef0123';
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    process.env.GITHUB_CLIENT_ID = 'gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
    delete process.env.FEATURE_SSO_ENABLED;
    prisma = new FakePrisma();
    redis = new FakeRedisService();
    firebase.verifyIdToken.mockReset();
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      providers: [
        AuthService,
        SessionService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: FirebaseIdentityService, useValue: firebase },
        { provide: MailService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  /** Compte lié à tous les fournisseurs, pour que chaque méthode retrouve le même utilisateur. */
  const seedUser = async (overrides: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: {
        id: 'user-1',
        email: 'ada@acme.com',
        name: 'Ada',
        passwordHash: await hashPassword(PASSWORD),
        firebaseUid: 'fb-1',
        githubId: '4242',
        ssoUid: 'azure-ad:oid-1',
        ...overrides,
      },
    });

  const mockGitHub = () =>
    jest.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (String(url).includes('login/oauth/access_token')) return json({ access_token: 'gho_x' });
      if (String(url).endsWith('/user/emails'))
        return json([{ email: 'ada@acme.com', primary: true, verified: true }]);
      return json({ id: 4242, login: 'ada', name: 'Ada', email: 'ada@acme.com' });
    }) as unknown as typeof fetch);

  const oauthState = () => {
    const { state, cookieValue } = createGithubOAuthState('login');
    return { state, cookie: cookieValue };
  };

  type Method = 'password' | 'firebase' | 'github' | 'sso';
  const attempt = (method: Method) => {
    switch (method) {
      case 'password':
        return service.login('ada@acme.com', PASSWORD);
      case 'firebase':
        firebase.verifyIdToken.mockResolvedValue({
          uid: 'fb-1',
          email: 'ada@acme.com',
          email_verified: true,
        });
        return service.loginWithFirebase('id-token');
      case 'github':
        mockGitHub();
        return service.loginWithGitHub('code', oauthState());
      case 'sso':
        return prisma.user
          .findUnique({ where: { id: 'user-1' } })
          .then((user) => service.completeLogin(user as never, { method: 'sso' } as never));
    }
  };
  const methods: Method[] = ['password', 'firebase', 'github', 'sso'];
  const sessionsIssued = () => prisma.refreshToken.rows.length;

  describe.each(methods)('méthode %s', (method) => {
    it('compte suspendu : 403, aucune session', async () => {
      await seedUser({ isSuspended: true });
      await expect(attempt(method)).rejects.toThrow(ForbiddenException);
      expect(sessionsIssued()).toBe(0);
    });

    it('MFA actif : mfaRequired + ticket, aucune session ni accessToken', async () => {
      await seedUser({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' });
      const result = (await attempt(method)) as unknown as Record<string, unknown>;
      expect(result.mfaRequired).toBe(true);
      expect(result.mfaTicket).toEqual(expect.any(String));
      expect(result.session).toBeUndefined();
      expect(JSON.stringify(result)).not.toMatch(/accessToken/);
      expect(sessionsIssued()).toBe(0);
    });

    it('compte sans particularité : session émise', async () => {
      await seedUser();
      const result = (await attempt(method)) as unknown as { session?: { accessToken: string } };
      expect(result.session?.accessToken).toEqual(expect.any(String));
      expect(sessionsIssued()).toBe(1);
    });
  });

  describe('enforceSSO du domaine', () => {
    const enforce = () =>
      prisma.sSOConfiguration.create({
        data: { domain: 'acme.com', enabled: true, enforceSSO: true, provider: 'OIDC_AZURE_AD' },
      });

    it.each(['password', 'firebase', 'github'] as const)(
      'fonctionnalité SSO active : %s refusé (403), aucune session',
      async (method) => {
        process.env.FEATURE_SSO_ENABLED = 'true';
        await seedUser();
        await enforce();
        await expect(attempt(method)).rejects.toThrow(ForbiddenException);
        expect(sessionsIssued()).toBe(0);
      },
    );

    it('fonctionnalité SSO active : la connexion SSO reste autorisée', async () => {
      process.env.FEATURE_SSO_ENABLED = 'true';
      await seedUser();
      await enforce();
      const result = (await attempt('sso')) as unknown as { session?: unknown };
      expect(result.session).toBeDefined();
    });

    it('fonctionnalité SSO désactivée (P3) : enforceSSO n’enferme personne dehors', async () => {
      await seedUser();
      await enforce();
      const result = (await attempt('password')) as unknown as { session?: unknown };
      expect(result.session).toBeDefined();
    });
  });

  describe('challenge MFA', () => {
    it('un ticket issu d’une connexion SSO aboutit même avec enforceSSO (méthode d’origine conservée)', async () => {
      process.env.FEATURE_SSO_ENABLED = 'true';
      await seedUser({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' });
      await prisma.sSOConfiguration.create({
        data: { domain: 'acme.com', enabled: true, enforceSSO: true, provider: 'OIDC_AZURE_AD' },
      });
      const user = await prisma.user.findUnique({ where: { id: 'user-1' } });
      const result = (await service.completeLogin(
        user as never,
        {
          method: 'sso',
        } as never,
      )) as unknown as {
        mfaTicket: string;
      };
      const { generateTotpCode } = await import('../../../src/auth/totp.util');
      const done = await service.verifyMfaChallenge(result.mfaTicket, {
        code: generateTotpCode('JBSWY3DPEHPK3PXP'),
      });
      expect(done.session.accessToken).toEqual(expect.any(String));
    });

    it('un compte suspendu entre le ticket et le challenge : 403', async () => {
      await seedUser({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' });
      const result = (await service.login('ada@acme.com', PASSWORD)) as { mfaTicket: string };
      await prisma.user.update({ where: { id: 'user-1' }, data: { isSuspended: true } });
      const { generateTotpCode } = await import('../../../src/auth/totp.util');
      await expect(
        service.verifyMfaChallenge(result.mfaTicket, {
          code: generateTotpCode('JBSWY3DPEHPK3PXP'),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(sessionsIssued()).toBe(0);
    });
  });

  describe('impersonation', () => {
    it('refuse d’impersoner un compte suspendu', async () => {
      await seedUser({ isSuspended: true });
      const user = await prisma.user.findUnique({ where: { id: 'user-1' } });
      await expect(
        service.completeLogin(
          user as never,
          { method: 'impersonation', impersonatedBy: 'adm' } as never,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('n’impose pas le MFA du compte cible mais émet une session sans refresh', async () => {
      await seedUser({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' });
      const user = await prisma.user.findUnique({ where: { id: 'user-1' } });
      const result = (await service.completeLogin(
        user as never,
        {
          method: 'impersonation',
          impersonatedBy: 'adm',
        } as never,
      )) as { session: { refreshToken?: string } };
      expect(result.session.refreshToken).toBeUndefined();
    });
  });

  describe('liaison d’identité externe : jamais automatique', () => {
    const firebaseIdentity = {
      uid: 'fb-new',
      email: 'ada@acme.com',
      email_verified: true,
      name: 'Ada',
    };

    it('Firebase vérifié sur un compte existant non lié : 409, aucun update, firebaseUid inchangé', async () => {
      await seedUser({ firebaseUid: null });
      firebase.verifyIdToken.mockResolvedValue(firebaseIdentity);
      const updateSpy = jest.spyOn(prisma.user, 'update');

      await expect(service.loginWithFirebase('id-token')).rejects.toThrow(ConflictException);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(prisma.user.rows[0].firebaseUid).toBeNull();
      expect(sessionsIssued()).toBe(0);
    });

    it('compte provisionné par SCIM, sans identifiant propre : 409, jamais réclamé par Firebase', async () => {
      await seedUser({
        firebaseUid: null,
        passwordHash: null,
        provisionedByWorkspaceId: 'ws-attaquant',
      });
      firebase.verifyIdToken.mockResolvedValue(firebaseIdentity);
      const updateSpy = jest.spyOn(prisma.user, 'update');

      await expect(service.loginWithFirebase('id-token')).rejects.toThrow(ConflictException);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(prisma.user.rows[0].firebaseUid).toBeNull();
    });

    it('Firebase sur un e-mail inconnu : le compte est créé', async () => {
      firebase.verifyIdToken.mockResolvedValue(firebaseIdentity);
      const result = (await service.loginWithFirebase('id-token')) as unknown as {
        session?: unknown;
      };
      expect(result.session).toBeDefined();
      expect(prisma.user.rows).toHaveLength(1);
    });
  });
});
