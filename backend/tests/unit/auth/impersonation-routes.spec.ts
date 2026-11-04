import { ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AdminController } from '../../../src/admin/admin.controller';
import { AuthController } from '../../../src/auth/auth.controller';
import { IS_FORBIDDEN_IN_IMPERSONATION } from '../../../src/auth/forbidden-in-impersonation.decorator';
import { JwtAuthGuard } from '../../../src/auth/jwt.guard';
import { IS_PUBLIC_KEY } from '../../../src/auth/public.decorator';
import { SsoController } from '../../../src/auth/sso/sso.controller';
import { ScimController } from '../../../src/auth/scim/scim.controller';
import { InvitationsController } from '../../../src/projects/invitations.controller';
import { ProjectsController } from '../../../src/projects/projects.controller';

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
    // S18.2-bis : accès persistant aux espaces de la cible
    [InvitationsController, 'createInvitation'],
    [ProjectsController, 'assignProjectRole'],
    [ProjectsController, 'removeProjectRole'],
    [ScimController, 'createApiKey'],
    [SsoController, 'configureWorkspaceSSO'],
    [SsoController, 'verifyDomain'],
    [SsoController, 'deleteWorkspaceSSO'],
    [ProjectsController, 'createIntegration'],
    [ProjectsController, 'handleOAuthCallback'],
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

    // Depuis A1, toute route non @Public() lit la session (garde global). Une route publique
    // (ex. /auth/mfa/challenge, authentifiée par un ticket) ne la lit jamais : hors du balayage.
    const isPublic = (r: { handler: () => void; controller: object }) =>
      reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [r.handler, r.controller as never]) ===
      true;
    const isMarked = (r: { handler: () => void; controller: object }) =>
      reflector.getAllAndOverride<boolean>(IS_FORBIDDEN_IN_IMPERSONATION, [
        r.handler,
        r.controller as never,
      ]) === true;

    // S18.2-bis : routes qui créent un accès durable aux données d'un espace (invitation, rôle de
    // projet, clé SCIM, SSO, intégration sortante). Méthode explicite pour ne pas viser les lectures.
    const PERSISTENT_ACCESS: Array<{ method: RequestMethod[]; pattern: RegExp }> = [
      {
        method: [RequestMethod.POST],
        pattern: /^\/projects\/workspaces\/:workspaceId\/invitations$/,
      },
      { method: [RequestMethod.POST], pattern: /^\/projects\/:id\/members$/ },
      { method: [RequestMethod.DELETE], pattern: /^\/projects\/:id\/members\/:userId$/ },
      { method: [RequestMethod.POST], pattern: /^\/workspaces\/:workspaceId\/scim\/keys$/ },
      {
        method: [RequestMethod.POST, RequestMethod.DELETE],
        pattern: /^\/workspaces\/:workspaceId\/sso(\/verify-domain)?$/,
      },
      {
        method: [RequestMethod.POST],
        pattern: /^\/projects\/workspaces\/:workspaceId\/integrations$/,
      },
      {
        method: [RequestMethod.POST],
        pattern: /^\/projects\/workspaces\/:workspaceId\/calendar\/oauth\/callback$/,
      },
    ];

    const all = [
      AuthController,
      AdminController,
      SsoController,
      ScimController,
      InvitationsController,
      ProjectsController,
    ].flatMap(routesOf);
    const sensitive = all.filter(
      (r) =>
        // Les routes publiques ne lisent jamais la session : le garde ne s'y applique pas
        !isPublic(r) &&
        (SENSITIVE.some((pattern) => pattern.test(r.full)) ||
          PERSISTENT_ACCESS.some(
            (p) => p.method.includes(r.method as RequestMethod) && p.pattern.test(r.full),
          )),
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
          '/projects/workspaces/:workspaceId/invitations',
          '/projects/:id/members',
          '/projects/:id/members/:userId',
          '/workspaces/:workspaceId/scim/keys',
          '/workspaces/:workspaceId/sso',
          '/workspaces/:workspaceId/sso/verify-domain',
          '/projects/workspaces/:workspaceId/integrations',
          '/projects/workspaces/:workspaceId/calendar/oauth/callback',
        ]),
      );
    });

    it.each(sensitive.map((r) => [r.full, r] as const))('%s porte le décorateur', (_full, r) => {
      expect(isMarked(r)).toBe(true);
    });
  });
});
