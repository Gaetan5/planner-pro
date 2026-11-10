import { ForbiddenException, INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PolicyService } from '../../src/authz/policy.service';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { decrypt, encrypt } from '../../src/auth/encryption.util';
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

/** P9-R : « Connecter un dépôt », route `POST /auth/github/sync` et `GET /auth/github/repos` (HTTP). */
describe('P9-R : liaison d’un dépôt GitHub à un projet (HTTP)', () => {
  const JWT_SECRET = 'test-secret-p9r-repos-0123456789abcdef01234567';
  let app: INestApplication;
  let baseUrl: string;
  let prisma: FakePrisma;
  let token: string;
  let impersonation: string;
  let loggedOut: string;
  const realFetch = global.fetch;
  const policy = { assertProject: jest.fn() };
  const github = jest.fn();
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    prisma = new FakePrisma();
    ({ app, baseUrl } = await startHttpTestApp({
      imports: [JwtModule.register({ global: true, secret: JWT_SECRET }), TokenModule],
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: MailService, useValue: {} },
        { provide: PolicyService, useValue: policy },
        JwtAuthGuard,
        SessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirebaseIdentityService, useValue: {} },
        { provide: RedisService, useValue: new FakeRedisService() },
      ],
    }));
    const sessions = app.get(SessionService);
    const user = { id: 'u-1', email: 'ada@corp.com', name: 'Ada' };
    token = (await sessions.issue(user)).accessToken;
    impersonation = (await sessions.issue(user, { impersonatedBy: 'admin-1' })).accessToken;
    loggedOut = (await sessions.issue({ id: 'u-2', email: 'bob@corp.com', name: 'Bob' }))
      .accessToken;
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    policy.assertProject.mockResolvedValue({ id: 'p-1' });
    prisma.user.rows = [];
    prisma.project.rows = [];
    await prisma.user.create({
      data: {
        id: 'u-1',
        email: 'ada@corp.com',
        name: 'Ada',
        githubId: '4242',
        githubAccessToken: encrypt('gho_secret'),
      },
    });
    await prisma.user.create({ data: { id: 'u-2', email: 'bob@corp.com', name: 'Bob' } });
    await prisma.project.create({ data: { id: 'p-1', name: 'Projet', githubRepo: null } });
    // Les appels vers le serveur de test passent ; tout le reste est GitHub (simulé).
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(((url: string, init?: RequestInit) =>
        String(url).startsWith(baseUrl)
          ? realFetch(url, init)
          : github(url, init)) as typeof fetch);
    github.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ full_name: 'owner/Repo' }),
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const sync = (body: unknown, auth = token) =>
    fetch(`${baseUrl}/auth/github/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const repoOf = () => prisma.project.rows.find((p) => p.id === 'p-1')?.githubRepo ?? null;

  describe('validation du corps (DTO)', () => {
    it.each([
      ['projectId objet d’opérateurs', { projectId: { not: '' }, repoFullName: 'owner/repo' }],
      ['projectId trop long', { projectId: 'x'.repeat(65), repoFullName: 'owner/repo' }],
      ['dépôt sans propriétaire', { projectId: 'p-1', repoFullName: 'repo' }],
      ['dépôt avec trois segments', { projectId: 'p-1', repoFullName: 'a/b/c' }],
      ['dépôt avec remontée de chemin', { projectId: 'p-1', repoFullName: '../repo/x' }],
      ['dépôt nommé « .. »', { projectId: 'p-1', repoFullName: 'owner/..' }],
      ['dépôt nommé « . »', { projectId: 'p-1', repoFullName: 'owner/.' }],
      ['dépôt avec paramètre de requête', { projectId: 'p-1', repoFullName: 'owner/repo?x=1' }],
      ['dépôt trop long', { projectId: 'p-1', repoFullName: `owner/${'r'.repeat(101)}` }],
      ['propriétaire trop long', { projectId: 'p-1', repoFullName: `${'o'.repeat(40)}/repo` }],
      ['dépôt absent', { projectId: 'p-1' }],
    ])('%s : 400, ni contrôle de droit ni appel à GitHub', async (_label, body) => {
      expect((await sync(body)).status).toBe(400);
      expect(policy.assertProject).not.toHaveBeenCalled();
      expect(github).not.toHaveBeenCalled();
      expect(repoOf()).toBeNull();
    });

    it('le dépôt n’est jamais lu dans le chemin', async () => {
      const res = await fetch(`${baseUrl}/auth/github/sync/owner/repo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p-1' }),
      });
      expect(res.status).toBe(404);
      expect(github).not.toHaveBeenCalled();
    });
  });

  describe('autorisation', () => {
    it('sans droit project.manage : 403, GitHub non appelé, aucune écriture', async () => {
      policy.assertProject.mockRejectedValue(new ForbiddenException('Accès non autorisé'));
      const res = await sync({ projectId: 'p-1', repoFullName: 'owner/repo' });
      expect(res.status).toBe(403);
      expect(policy.assertProject).toHaveBeenCalledWith('p-1', 'u-1', 'project.manage');
      expect(github).not.toHaveBeenCalled();
      expect(repoOf()).toBeNull();
    });

    it('non authentifié : 401', async () => {
      const res = await fetch(`${baseUrl}/auth/github/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p-1', repoFullName: 'owner/repo' }),
      });
      expect(res.status).toBe(401);
    });

    it('en impersonation : 403 sur sync et sur repos, GitHub non appelé', async () => {
      expect(
        (await sync({ projectId: 'p-1', repoFullName: 'owner/repo' }, impersonation)).status,
      ).toBe(403);
      const repos = await fetch(`${baseUrl}/auth/github/repos`, {
        headers: { Authorization: `Bearer ${impersonation}` },
      });
      expect(repos.status).toBe(403);
      expect(github).not.toHaveBeenCalled();
    });
  });

  describe('vérification du dépôt chez GitHub', () => {
    it('sans compte GitHub avec jeton : 400, GitHub non appelé', async () => {
      const res = await sync({ projectId: 'p-1', repoFullName: 'owner/repo' }, loggedOut);
      expect(res.status).toBe(400);
      expect(github).not.toHaveBeenCalled();
      expect(repoOf()).toBeNull();
    });

    it.each([404, 403, 401, 500])('GitHub répond %i : 400, aucune écriture', async (status) => {
      github.mockResolvedValue({
        status,
        ok: false,
        json: async () => ({ full_name: 'owner/Repo' }),
      });
      const res = await sync({ projectId: 'p-1', repoFullName: 'owner/repo' });
      expect(res.status).toBe(400);
      expect(repoOf()).toBeNull();
    });

    it('réponse GitHub sans nom canonique valide : 400, aucune écriture', async () => {
      github.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ full_name: '../x' }),
      });
      expect((await sync({ projectId: 'p-1', repoFullName: 'owner/repo' })).status).toBe(400);
      expect(repoOf()).toBeNull();
    });

    it('délai dépassé : 503, aucune écriture', async () => {
      github.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
      expect((await sync({ projectId: 'p-1', repoFullName: 'owner/repo' })).status).toBe(503);
      expect(repoOf()).toBeNull();
    });

    it('succès : jeton de l’utilisateur, segments encodés, délai borné, nom canonique enregistré', async () => {
      const res = await sync({ projectId: 'p-1', repoFullName: 'OWNER/repo.js' });
      expect(res.status).toBe(201);
      expect(github).toHaveBeenCalledTimes(1);
      const [url, init] = github.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.github.com/repos/OWNER/repo.js');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gho_secret');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(repoOf()).toBe('owner/Repo'); // full_name renvoyé par GitHub, pas la saisie
    });

    // S22/O16 : la réponse porte le secret du webhook en clair, elle ne doit pas être mise en cache
    it('réponse de la liaison (secret en clair) : Cache-Control no-store', async () => {
      const res = await sync({ projectId: 'p-1', repoFullName: 'owner/repo' });
      expect(res.status).toBe(201);
      expect((await res.json()).webhookSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('pragma')).toBe('no-cache');
    });

    describe('secret de webhook (S21)', () => {
      const storedSecret = () =>
        prisma.project.rows.find((p) => p.id === 'p-1')?.githubWebhookSecret as string | undefined;
      const link = async () =>
        (await (await sync({ projectId: 'p-1', repoFullName: 'owner/repo' })).json()) as Record<
          string,
          unknown
        >;

      it('première liaison : secret de 32 octets renvoyé une fois, stocké chiffré', async () => {
        const body = await link();
        expect(body.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
        expect(storedSecret()).toBeDefined();
        expect(storedSecret()).not.toContain(body.webhookSecret as string);
        expect(decrypt(storedSecret() as string)).toBe(body.webhookSecret);
        // le secret chiffré n'est pas non plus renvoyé
        expect(JSON.stringify(body)).not.toContain(storedSecret() as string);
      });

      it('même dépôt relié de nouveau : secret conservé, rien de réaffiché', async () => {
        const first = await link();
        const stored = storedSecret();
        const second = await link();
        expect(second.webhookSecret).toBeUndefined();
        expect(storedSecret()).toBe(stored);
        expect(decrypt(stored as string)).toBe(first.webhookSecret);
      });

      it('autre dépôt : nouveau secret, l’ancien cesse de valoir', async () => {
        const first = await link();
        github.mockResolvedValue({
          status: 200,
          ok: true,
          json: async () => ({ full_name: 'owner/Autre' }),
        });
        const body = (await (
          await sync({ projectId: 'p-1', repoFullName: 'owner/autre' })
        ).json()) as Record<string, unknown>;
        expect(body.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
        expect(body.webhookSecret).not.toBe(first.webhookSecret);
        expect(decrypt(storedSecret() as string)).toBe(body.webhookSecret);
      });

      it('échec de la vérification GitHub : aucun secret écrit', async () => {
        github.mockResolvedValue({ status: 404, ok: false, json: async () => ({}) });
        expect((await sync({ projectId: 'p-1', repoFullName: 'owner/repo' })).status).toBe(400);
        expect(storedSecret()).toBeUndefined();
      });
    });
  });

  describe('GET /auth/github/repos', () => {
    const listRepos = () =>
      fetch(`${baseUrl}/auth/github/repos`, { headers: { Authorization: `Bearer ${token}` } });

    it('succès : liste des dépôts', async () => {
      github.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => [
          { id: 1, name: 'api', full_name: 'acme/api', private: true, html_url: 'u' },
        ],
      });
      const res = await listRepos();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([expect.objectContaining({ fullName: 'acme/api' })]);
    });

    it('GitHub 401 (jeton révoqué) : 403 dédié, jamais 401', async () => {
      github.mockResolvedValue({ status: 401, ok: false, json: async () => ({}) });
      const res = await listRepos();
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toContain('Jeton GitHub invalide');
    });

    it.each([500, 502, 429, 403, 404])('GitHub %i : 503', async (status) => {
      github.mockResolvedValue({ status, ok: false, json: async () => ({}) });
      expect((await listRepos()).status).toBe(503);
    });

    it('sans jeton GitHub : 400, GitHub non appelé', async () => {
      const res = await fetch(`${baseUrl}/auth/github/repos`, {
        headers: { Authorization: `Bearer ${loggedOut}` },
      });
      expect(res.status).toBe(400);
      expect(github).not.toHaveBeenCalled();
    });

    it('délai dépassé : 503', async () => {
      github.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
      const res = await fetch(`${baseUrl}/auth/github/repos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(503);
      const [, init] = github.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  it('limites de débit : 10/min sur repos et sur sync', () => {
    const limitOf = (name: 'getGitHubRepositories' | 'syncRepository') =>
      Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        (AuthController.prototype as unknown as Record<string, () => void>)[name],
      );
    expect(limitOf('getGitHubRepositories')).toBe(10);
    expect(limitOf('syncRepository')).toBe(10);
  });
});
