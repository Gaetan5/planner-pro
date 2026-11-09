import { APP_GUARD } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-a1-0123456789abcdef0123456789';

/**
 * A1 : authentification par défaut. Liste blanche figée des routes publiques : toute nouvelle
 * route publique doit être ajoutée ici EXPLICITEMENT, après revue de sécurité.
 */
const PUBLIC_ROUTES_ALLOWLIST = [
  'GET /',
  'GET /features',
  'GET /auth/github/authorize',
  'GET /auth/github/pending',
  'POST /auth/github/login',
  'POST /auth/register',
  'POST /auth/email/verify',
  'POST /auth/email/resend',
  'POST /auth/password/forgot',
  'POST /auth/password/reset',
  'POST /auth/login',
  'POST /auth/mfa/challenge',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/firebase/login',
  'POST /auth/sso/discover',
  'GET /auth/sso/authorize',
  'POST /auth/sso/callback',
  'GET /scim/v2/ServiceProviderConfig',
  'GET /scim/v2/Users',
  'GET /scim/v2/Users/:id',
  'POST /scim/v2/Users',
  'PUT /scim/v2/Users/:id',
  'PATCH /scim/v2/Users/:id',
  'DELETE /scim/v2/Users/:id',
  'GET /projects/invitations/check/:token',
  'POST /projects/webhooks/github',
].sort();

type Ctor = new (...args: never[]) => unknown;
interface RouteInfo {
  route: string;
  isPublic: boolean;
  guards: unknown[];
}

function collectModules(root: unknown, seen = new Set<unknown>()): Ctor[] {
  const mod = (root as { module?: Ctor }).module ?? (root as Ctor);
  if (seen.has(mod)) return [];
  seen.add(mod);
  const imports: unknown[] = Reflect.getMetadata('imports', mod) ?? [];
  return [mod, ...imports.flatMap((m) => collectModules(m, seen))];
}

function listRoutes(modules: Ctor[]): RouteInfo[] {
  const controllers = modules.flatMap(
    (m) => (Reflect.getMetadata('controllers', m) ?? []) as Ctor[],
  );
  const routes: RouteInfo[] = [];
  for (const controller of controllers) {
    const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const full = `/${[prefix, path].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
      routes.push({
        route: `${RequestMethod[method]} ${full}`,
        isPublic:
          Reflect.getMetadata('isPublic', handler) === true ||
          Reflect.getMetadata('isPublic', controller) === true,
        guards: [
          ...((Reflect.getMetadata('__guards__', controller) ?? []) as unknown[]),
          ...((Reflect.getMetadata('__guards__', handler) ?? []) as unknown[]),
        ],
      });
    }
  }
  return routes;
}

describe('A1 : authentification globale par défaut', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../../../src/app.module');
  const modules = collectModules(AppModule);
  const routes = listRoutes(modules);

  it('l’inventaire trouve les contrôleurs de l’application', () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it('les routes publiques sont exactement la liste blanche figée', () => {
    const publicRoutes = routes
      .filter((r) => r.isPublic)
      .map((r) => r.route)
      .sort();
    expect(publicRoutes).toEqual(PUBLIC_ROUTES_ALLOWLIST);
  });

  it('JwtAuthGuard est un garde GLOBAL, après le limiteur de débit et le drapeau de fonctionnalité', () => {
    const providers = (Reflect.getMetadata('providers', AppModule) ?? []) as {
      provide?: unknown;
      useClass?: { name: string };
    }[];
    const globals = providers.filter((p) => p.provide === APP_GUARD).map((p) => p.useClass?.name);
    expect(globals).toEqual(['AppThrottlerGuard', 'FeatureFlagGuard', 'JwtAuthGuard']);
  });

  it('aucun contrôleur ne répète JwtAuthGuard (une seule vérification de session par requête)', () => {
    const repeated = routes.filter((r) =>
      r.guards.some((g) => (g as { name?: string }).name === 'JwtAuthGuard'),
    );
    expect(repeated.map((r) => r.route)).toEqual([]);
  });
});
