import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from '../../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../../src/auth/firebase-identity.service';
import { MailService } from '../../../src/mail/mail.service';
import { SessionService } from '../../../src/auth/session.service';
import { TokenService } from '../../../src/auth/token.service';
import { decrypt, encrypt } from '../../../src/auth/encryption.util';
import {
  createGithubOAuthState,
  readGithubOAuthPurpose,
  verifyGithubOAuthState,
} from '../../../src/auth/github-oauth-state';
import { GithubPurpose } from '../../../src/auth/dto/github.dto';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';
import { FakePrisma } from '../../http/fake-prisma';
import { FakeRedisService } from '../../http/fake-redis';

type FetchPlan = {
  token?: { ok?: boolean; body?: unknown };
  user?: { ok?: boolean; body?: unknown };
  emails?: { ok?: boolean; body?: unknown };
};

/**
 * S9 : OAuth GitHub. `state` obligatoire, identité par githubId, e-mails vérifiés uniquement,
 * jamais de liaison automatique par e-mail, portée minimale, vérification des réponses GitHub.
 */
describe('S9 : OAuth GitHub', () => {
  const savedEnv = { ...process.env };
  let service: AuthService;
  let prisma: FakePrisma;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret-s9-github-0123456789abcdef0123';
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    process.env.GITHUB_CLIENT_ID = 'gh-client';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
    process.env.FRONTEND_URL = 'https://app.planner.test';
    prisma = new FakePrisma();
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      providers: [
        AuthService,
        SessionService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: new FakeRedisService() },
        { provide: FirebaseIdentityService, useValue: {} },
        { provide: MailService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  const mockGitHub = (plan: FetchPlan = {}) => {
    const reply = (cfg: { ok?: boolean; body?: unknown } | undefined, fallback: unknown) => ({
      ok: cfg?.ok ?? true,
      status: cfg?.ok === false ? 500 : 200,
      json: async () => cfg?.body ?? fallback,
    });
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      const target = String(url);
      if (target.includes('login/oauth/access_token')) {
        return reply(plan.token, { access_token: 'gho_secret_token' });
      }
      if (target.endsWith('/user/emails')) {
        return reply(plan.emails, [{ email: 'ada@corp.com', primary: true, verified: true }]);
      }
      return reply(plan.user, { id: 4242, login: 'ada', name: 'Ada', email: 'ada@corp.com' });
    }) as unknown as typeof fetch);
  };
  const oauth = (purpose: GithubPurpose = 'login') => {
    const { state, cookieValue } = createGithubOAuthState(purpose);
    return { state, cookie: cookieValue };
  };
  const userCount = () => prisma.user.rows.length;

  describe('state (CSRF de connexion)', () => {
    it.each([
      ['absent', () => ({ state: undefined, cookie: oauth().cookie })],
      ['sans cookie', () => ({ state: oauth().state, cookie: undefined })],
      ['différent de celui du cookie', () => ({ state: oauth().state, cookie: oauth().cookie })],
    ])('state %s : 401, aucun appel à GitHub, aucun compte', async (_label, make) => {
      mockGitHub();
      await expect(service.loginWithGitHub('code', make())).rejects.toThrow(UnauthorizedException);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(userCount()).toBe(0);
    });

    it('un cookie falsifié (signature invalide) est rejeté', () => {
      const { state, cookieValue } = createGithubOAuthState();
      const forged = `${state}.${'0'.repeat(64)}`;
      expect(() => verifyGithubOAuthState(forged, state, ['login'])).toThrow(UnauthorizedException);
      expect(() => verifyGithubOAuthState(cookieValue, state, ['login'])).not.toThrow();
    });

    it('le state fait au moins 32 octets aléatoires et diffère à chaque appel', () => {
      const a = createGithubOAuthState();
      const b = createGithubOAuthState();
      expect(Buffer.from(a.state, 'base64url').length).toBeGreaterThanOrEqual(32);
      expect(a.state).not.toBe(b.state);
    });
  });

  describe('réponses GitHub', () => {
    it.each([
      ['échange du code', { token: { ok: false } }],
      ['profil /user', { user: { ok: false } }],
      ['e-mails /user/emails', { emails: { ok: false } }],
    ])('%s en erreur HTTP : 401, aucun compte créé', async (_label, plan) => {
      mockGitHub(plan);
      await expect(service.loginWithGitHub('code', oauth())).rejects.toThrow(UnauthorizedException);
      expect(userCount()).toBe(0);
    });
  });

  describe('identité', () => {
    it('e-mail primaire non vérifié : 401 (aucun e-mail fabriqué @github.planner.pro)', async () => {
      mockGitHub({ emails: { body: [{ email: 'ada@corp.com', primary: true, verified: false }] } });
      await expect(service.loginWithGitHub('code', oauth())).rejects.toThrow(UnauthorizedException);
      expect(userCount()).toBe(0);
    });

    it('aucun e-mail du tout : 401, jamais d’e-mail fabriqué', async () => {
      mockGitHub({ emails: { body: [] }, user: { body: { id: 7, login: 'ghost', email: null } } });
      await expect(service.loginWithGitHub('code', oauth())).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.rows.some((u) => String(u.email).includes('github.planner.pro'))).toBe(
        false,
      );
    });

    it('l’e-mail public du profil n’est pas cru : seul un e-mail vérifié de /user/emails compte', async () => {
      mockGitHub({
        user: { body: { id: 66, login: 'eve', name: 'Eve', email: 'victime@corp.com' } },
        emails: { body: [{ email: 'eve@evil.test', primary: true, verified: true }] },
      });
      await service.loginWithGitHub('code', oauth());
      expect(prisma.user.rows.map((u) => u.email)).toEqual(['eve@evil.test']);
    });

    it('compte existant avec le même e-mail vérifié mais sans githubId : 409, aucun update, githubId inchangé', async () => {
      await prisma.user.create({ data: { id: 'victime', email: 'ada@corp.com', name: 'Ada' } });
      mockGitHub();
      const updateSpy = jest.spyOn(prisma.user, 'update');
      const upsertSpy = jest.spyOn(prisma.user, 'upsert');

      await expect(service.loginWithGitHub('code', oauth())).rejects.toThrow(ConflictException);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(upsertSpy).not.toHaveBeenCalled();
      expect(prisma.user.rows[0].githubId).toBeNull();
      expect(prisma.refreshToken.rows).toHaveLength(0);
    });

    it('compte déjà lié (githubId) : connexion même si son e-mail GitHub a changé, jeton stocké inchangé (S9-a)', async () => {
      const stored = encrypt('gho_repo_scope_token');
      await prisma.user.create({
        data: {
          id: 'u-1',
          email: 'ada@corp.com',
          name: 'Ada',
          githubId: '4242',
          githubAccessToken: stored,
        },
      });
      mockGitHub({
        emails: { body: [{ email: 'nouvelle@adresse.test', primary: true, verified: true }] },
      });

      const result = await service.loginWithGitHub('code', oauth());

      expect('session' in result && result.session.accessToken).toEqual(expect.any(String));
      expect(prisma.user.rows).toHaveLength(1);
      expect(prisma.user.rows[0].email).toBe('ada@corp.com');
      expect(prisma.user.rows[0].githubAccessToken).toBe(stored);
    });

    it('nouveau compte : créé avec l’e-mail vérifié et le githubId, sans jeton GitHub persisté (S9-a)', async () => {
      mockGitHub();
      const result = await service.loginWithGitHub('code', oauth());
      expect('session' in result).toBe(true);
      expect(prisma.user.rows).toHaveLength(1);
      expect(prisma.user.rows[0]).toEqual(
        expect.objectContaining({ email: 'ada@corp.com', githubId: '4242' }),
      );
      expect(prisma.user.rows[0].githubAccessToken ?? null).toBeNull();
    });
  });

  describe('liaison depuis une session authentifiée', () => {
    it('lie le compte GitHub au compte connecté', async () => {
      await prisma.user.create({ data: { id: 'u-1', email: 'ada@corp.com', name: 'Ada' } });
      mockGitHub();
      await service.linkGitHubAccount('u-1', 'code', oauth('link'));
      expect(prisma.user.rows[0].githubId).toBe('4242');
    });

    it('refuse un compte GitHub déjà lié à un autre utilisateur (409)', async () => {
      await prisma.user.create({ data: { id: 'u-1', email: 'ada@corp.com', name: 'Ada' } });
      await prisma.user.create({
        data: { id: 'u-2', email: 'autre@corp.com', name: 'Autre', githubId: '4242' },
      });
      mockGitHub();
      await expect(service.linkGitHubAccount('u-1', 'code', oauth('link'))).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.rows[0].githubId).toBeNull();
    });

    it('S9-a : liaison simple (finalité link) : githubId posé, aucun jeton persisté', async () => {
      await prisma.user.create({ data: { id: 'u-1', email: 'ada@corp.com', name: 'Ada' } });
      mockGitHub();
      await service.linkGitHubAccount('u-1', 'code', oauth('link'));
      expect(prisma.user.rows[0].githubAccessToken ?? null).toBeNull();
    });

    it('S9-a : finalité repos avec la portée repo accordée : jeton stocké chiffré', async () => {
      await prisma.user.create({ data: { id: 'u-1', email: 'ada@corp.com', name: 'Ada' } });
      mockGitHub({
        token: { body: { access_token: 'gho_repo', scope: 'read:user,user:email,repo' } },
      });
      await service.linkGitHubAccount('u-1', 'code', oauth('repos'));
      expect(decrypt(prisma.user.rows[0].githubAccessToken as string)).toBe('gho_repo');
    });

    it('S9-a : finalité repos mais portée repo refusée par l’utilisateur : jeton non stocké', async () => {
      await prisma.user.create({ data: { id: 'u-1', email: 'ada@corp.com', name: 'Ada' } });
      mockGitHub({ token: { body: { access_token: 'gho_ro', scope: 'read:user,user:email' } } });
      await service.linkGitHubAccount('u-1', 'code', oauth('repos'));
      expect(prisma.user.rows[0].githubAccessToken ?? null).toBeNull();
    });

    it('exige aussi un state valide', async () => {
      await prisma.user.create({ data: { id: 'u-1', email: 'ada@corp.com', name: 'Ada' } });
      mockGitHub();
      await expect(
        service.linkGitHubAccount('u-1', 'code', { state: 'x', cookie: oauth('link').cookie }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('S9-a : connexion sans effet de bord avant completeLogin', () => {
    it('compte suspendu : refusé, aucune écriture (ni nom GitHub ni jeton)', async () => {
      const stored = encrypt('gho_repo_scope_token');
      await prisma.user.create({
        data: {
          id: 'u-1',
          email: 'ada@corp.com',
          name: 'Ada',
          githubId: '4242',
          githubUsername: 'ancien',
          githubAccessToken: stored,
          isSuspended: true,
        },
      });
      mockGitHub();
      const updateSpy = jest.spyOn(prisma.user, 'update');
      await expect(service.loginWithGitHub('code', oauth())).rejects.toThrow(ForbiddenException);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(prisma.user.rows[0].githubUsername).toBe('ancien');
      expect(prisma.user.rows[0].githubAccessToken).toBe(stored);
    });
  });

  describe('S9-b : finalité liée au state', () => {
    it('un state émis pour link présenté à la connexion : 401, aucun appel à GitHub', async () => {
      mockGitHub();
      await expect(service.loginWithGitHub('code', oauth('link'))).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.loginWithGitHub('code', oauth('repos'))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('un state émis pour login présenté à la liaison : 401, aucun appel à GitHub', async () => {
      await prisma.user.create({ data: { id: 'u-1', email: 'ada@corp.com', name: 'Ada' } });
      mockGitHub();
      await expect(service.linkGitHubAccount('u-1', 'code', oauth('login'))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('la finalité est signée : la modifier invalide le cookie', () => {
      const { state, cookieValue } = createGithubOAuthState('login');
      const [s, , sig] = cookieValue.split('.');
      expect(() => verifyGithubOAuthState(`${s}.repos.${sig}`, state, ['repos'])).toThrow(
        UnauthorizedException,
      );
    });

    it('readGithubOAuthPurpose expose la finalité d’un cookie valide seulement', () => {
      const { cookieValue } = createGithubOAuthState('link');
      expect(readGithubOAuthPurpose(cookieValue)).toBe('link');
      expect(readGithubOAuthPurpose(undefined)).toBeNull();
      expect(readGithubOAuthPurpose(cookieValue.replace('link', 'login'))).toBeNull();
    });

    it('buildGithubAuthorizeUrl signe la finalité demandée', () => {
      const { cookieValue } = service.buildGithubAuthorizeUrl('repos');
      expect(readGithubOAuthPurpose(cookieValue)).toBe('repos');
    });
  });

  describe('portée demandée', () => {
    it('connexion : read:user user:email, sans repo ; redirect_uri fixé côté serveur', () => {
      const { url } = service.buildGithubAuthorizeUrl('login');
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(parsed.searchParams.get('scope')).toBe('read:user user:email');
      expect(parsed.searchParams.get('scope')).not.toMatch(/repo/);
      expect(parsed.searchParams.get('client_id')).toBe('gh-client');
      expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.planner.test');
      expect(parsed.searchParams.get('state')).toBeTruthy();
    });

    it('repo n’est demandé que pour l’action « connecter un dépôt »', () => {
      const { url } = service.buildGithubAuthorizeUrl('repos');
      expect(new URL(url).searchParams.get('scope')).toBe('read:user user:email repo');
    });
  });
});
