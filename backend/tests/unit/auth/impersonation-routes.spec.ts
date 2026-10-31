import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AdminController } from '../../../src/admin/admin.controller';
import { AuthController } from '../../../src/auth/auth.controller';
import { IS_FORBIDDEN_IN_IMPERSONATION } from '../../../src/auth/forbidden-in-impersonation.decorator';
import { JwtAuthGuard } from '../../../src/auth/jwt.guard';
import { IS_PUBLIC_KEY } from '../../../src/auth/public.decorator';
import { SsoController } from '../../../src/auth/sso/sso.controller';

/**
 * S18.2 : une session d'impersonation (15 min) ne doit pas pouvoir créer un accès persistant au
 * compte cible (MFA, liaison GitHub ou Firebase, sessions) ni administrer. Le blocage est porté
 * par le décorateur @ForbiddenInImpersonation() et non par le chemin (le routage Express ignore la
 * casse : `/Auth/GitHub/Link` atteint le même gestionnaire).
 */
describe('S18.2 : routes interdites en session d’impersonation', () => {
  const reflector = new Reflector();
  const sessions = { verifyAccess: jest.fn() };
  const guard = new JwtAuthGuard(sessions as never, reflector);

  const contextFor = (
    controller: { prototype: object },
    handlerName: string,
    impersonatedBy?: string,
  ) => {
    sessions.verifyAccess.mockResolvedValue({
      sub: 'u-2',
      email: 'cible@corp.com',
      name: 'Cible',
      sid: 's-1',
      impersonatedBy,
    });
    const handler = (controller.prototype as Record<string, () => void>)[handlerName];
    // Le chemin de la requête est volontairement en casse mixte : il ne doit plus compter
    const request = {
      method: 'POST',
      path: '/Auth/GitHub/Link',
      headers: { authorization: 'Bearer jeton' },
    };
    return {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  const forbidden: Array<[{ prototype: object }, string]> = [
    [AuthController, 'linkGitHub'],
    [AuthController, 'linkFirebase'],
    [AuthController, 'setupMfa'],
    [AuthController, 'confirmMfa'],
    [AuthController, 'disableMfa'],
    [AuthController, 'regenerateRecoveryCodes'],
    [AuthController, 'revokeSession'],
    [AdminController, 'getOverview'],
    [AdminController, 'impersonateUser'],
  ];

  it.each(forbidden)(
    '%p.%s : 403 en impersonation, quel que soit le chemin demandé',
    async (c, h) => {
      await expect(guard.canActivate(contextFor(c, h, 'admin-1'))).rejects.toThrow(
        ForbiddenException,
      );
    },
  );

  it.each(forbidden)('%p.%s : autorisé hors impersonation', async (c, h) => {
    await expect(guard.canActivate(contextFor(c, h))).resolves.toBe(true);
  });

  it.each([
    [AuthController, 'listSessions'],
    [AuthController, 'logout'],
  ])('%p.%s : reste utilisable en impersonation', async (c, h) => {
    await expect(guard.canActivate(contextFor(c, h, 'admin-1'))).resolves.toBe(true);
  });

  // Test méta : tout gestionnaire protégé des routes MFA, des routes de liaison (link), des
  // sessions (DELETE) et de l'administration doit porter le décorateur : ajouter une route
  // sensible sans lui fait échouer ce test.
  describe('méta : chaque route sensible porte le décorateur', () => {
    const SENSITIVE = [/^\/auth\/mfa\//i, /\/link$/i, /^\/auth\/sessions\//i, /^\/admin(\/|$)/i];

    const routesOf = (controller: { prototype: object }) => {
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      const proto = controller.prototype as Record<string, unknown>;
      return Object.getOwnPropertyNames(proto)
        .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
        .map((name) => {
          const handler = proto[name] as () => void;
          const path = Reflect.getMetadata(PATH_METADATA, handler);
          const method = Reflect.getMetadata(METHOD_METADATA, handler);
          return { name, handler, controller, path, method };
        })
        .filter((r) => r.path !== undefined && r.method !== undefined)
        .map((r) => ({ ...r, full: `/${base}/${r.path}`.replace(/\/+/g, '/').replace(/\/$/, '') }));
    };

    // Une route sans JwtAuthGuard ne lit jamais la session (ex. /auth/mfa/challenge, authentifiée
    // par un ticket) : le décorateur n'aurait aucun effet, elle est hors du balayage.
    const usesSession = (r: { handler: () => void; controller: object }) =>
      [
        Reflect.getMetadata(GUARDS_METADATA, r.handler),
        Reflect.getMetadata(GUARDS_METADATA, r.controller),
      ]
        .flat()
        .includes(JwtAuthGuard);
    const isPublic = (r: { handler: () => void; controller: object }) =>
      reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [r.handler, r.controller as never]) ||
      !usesSession(r);
    const isMarked = (r: { handler: () => void; controller: object }) =>
      reflector.getAllAndOverride<boolean>(IS_FORBIDDEN_IN_IMPERSONATION, [
        r.handler,
        r.controller as never,
      ]) === true;

    const all = [AuthController, AdminController, SsoController].flatMap(routesOf);
    const sensitive = all.filter(
      (r) =>
        // Les routes publiques ne lisent jamais la session : le garde ne s'y applique pas
        !isPublic(r) && SENSITIVE.some((pattern) => pattern.test(r.full)),
    );

    it('le balayage trouve bien les routes attendues', () => {
      const found = sensitive.map((r) => r.full);
      expect(found).toEqual(
        expect.arrayContaining([
          '/auth/mfa/setup',
          '/auth/mfa/confirm',
          '/auth/mfa/disable',
          '/auth/mfa/recovery-codes',
          '/auth/github/link',
          '/auth/firebase/link',
          '/auth/sessions/:sid',
          '/admin/overview',
        ]),
      );
    });

    it.each(sensitive.map((r) => [r.full, r] as const))('%s porte le décorateur', (_full, r) => {
      expect(isMarked(r)).toBe(true);
    });
  });
});
