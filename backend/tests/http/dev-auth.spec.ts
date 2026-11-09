import { INestApplication } from '@nestjs/common';
import { AuthService } from '../../src/auth/auth.service';
import { DevAuthController, devAuthControllers } from '../../src/auth/dev-auth';
import { isDevAuthEnabled } from '../../src/auth/dev-auth-flag';
import { startHttpTestApp } from './http-test-app';

/**
 * P13-e (S26) : `POST /auth/mock/login` n'existe que si `NODE_ENV=development` ET
 * `ENABLE_DEV_AUTH=true`. Sinon, le contrôleur n'est pas enregistré : 404.
 */
describe('connexion simulée : disponibilité (P13-e)', () => {
  const mockLogin = jest.fn();

  const start = async (env: NodeJS.ProcessEnv) =>
    startHttpTestApp({
      controllers: devAuthControllers(env),
      providers: [{ provide: AuthService, useValue: { mockLogin } }],
    });

  beforeEach(() => {
    mockLogin.mockReset();
    mockLogin.mockResolvedValue({
      mfaRequired: true,
      mfaTicket: 'ticket',
      user: { id: 'u', email: 'u@x.fr' },
    });
  });

  const post = (baseUrl: string, body: unknown) =>
    fetch(`${baseUrl}/auth/mock/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it.each<[string, NodeJS.ProcessEnv]>([
    ['NODE_ENV absent', {}],
    ['NODE_ENV absent, drapeau actif', { ENABLE_DEV_AUTH: 'true' }],
    ['production, drapeau actif', { NODE_ENV: 'production', ENABLE_DEV_AUTH: 'true' }],
    ['staging, drapeau actif', { NODE_ENV: 'staging', ENABLE_DEV_AUTH: 'true' }],
    ['test, drapeau actif', { NODE_ENV: 'test', ENABLE_DEV_AUTH: 'true' }],
    ['development sans drapeau', { NODE_ENV: 'development' }],
    ['development, drapeau faux', { NODE_ENV: 'development', ENABLE_DEV_AUTH: 'false' }],
    ['development, drapeau TRUE (casse)', { NODE_ENV: 'development', ENABLE_DEV_AUTH: 'TRUE' }],
  ])('%s : la route n’existe pas (404), aucun appel au service', async (_label, env) => {
    expect(isDevAuthEnabled(env)).toBe(false);
    const { app, baseUrl } = await start(env);
    try {
      const res = await post(baseUrl, { name: 'Ada' });
      expect(res.status).toBe(404);
      expect(mockLogin).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  describe('development avec ENABLE_DEV_AUTH=true', () => {
    let app: INestApplication;
    let baseUrl: string;
    beforeAll(async () => {
      ({ app, baseUrl } = await start({ NODE_ENV: 'development', ENABLE_DEV_AUTH: 'true' }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('201 et appel du service', async () => {
      const res = await post(baseUrl, { name: 'Ada' });
      expect(res.status).toBe(201);
      expect(mockLogin).toHaveBeenCalledWith('Ada', expect.anything());
    });

    it.each([
      ['nom absent', {}],
      ['nom vide', { name: '' }],
      ['nom objet', { name: { $ne: 'x' } }],
      ['nom de 81 caractères', { name: 'a'.repeat(81) }],
    ])('%s : 400, aucun appel au service', async (_label, body) => {
      const res = await post(baseUrl, body);
      expect(res.status).toBe(400);
      expect(mockLogin).not.toHaveBeenCalled();
    });

    it('limite de débit : 5 par minute', () => {
      const handler = DevAuthController.prototype.mockLogin;
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(5);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60000);
    });
  });

  describe('branchement dans AuthModule', () => {
    const controllersWith = async (env: Record<string, string | undefined>) => {
      const saved = { ...process.env };
      Object.assign(process.env, {
        JWT_SECRET: 'test-secret-dev-auth-0123456789abcdef01234',
        ...env,
      });
      for (const key of Object.keys(env)) if (env[key] === undefined) delete process.env[key];
      try {
        let controllers: unknown[] = [];
        await jest.isolateModulesAsync(async () => {
          const { AuthModule } = await import('../../src/auth/auth.module');
          controllers = Reflect.getMetadata('controllers', AuthModule);
        });
        return controllers.map((c) => (c as { name: string }).name);
      } finally {
        process.env = saved;
      }
    };

    it('hors développement explicite : DevAuthController n’est pas enregistré', async () => {
      expect(await controllersWith({ NODE_ENV: 'test', ENABLE_DEV_AUTH: undefined })).not.toContain(
        'DevAuthController',
      );
      expect(
        await controllersWith({ NODE_ENV: 'production', ENABLE_DEV_AUTH: 'true' }),
      ).not.toContain('DevAuthController');
    });

    it('development avec ENABLE_DEV_AUTH=true : enregistré', async () => {
      expect(await controllersWith({ NODE_ENV: 'development', ENABLE_DEV_AUTH: 'true' })).toContain(
        'DevAuthController',
      );
    });
  });
});
