import { ROUTE_ARGS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { AdminController } from '../../../src/admin/admin.controller';
import { AppController } from '../../../src/app.controller';
import { AuthController } from '../../../src/auth/auth.controller';
import { DevAuthController } from '../../../src/auth/dev-auth';
import { ScimController } from '../../../src/auth/scim/scim.controller';
import { SsoController } from '../../../src/auth/sso/sso.controller';
import { NotesController } from '../../../src/notes/notes.controller';
import { NotificationsController } from '../../../src/notifications/notifications.controller';
import { AiController } from '../../../src/projects/ai.controller';
import { CommentsController } from '../../../src/projects/comments.controller';
import { GitHubWebhookController } from '../../../src/projects/github-webhook.controller';
import { InvitationsController } from '../../../src/projects/invitations.controller';
import { ProjectsController } from '../../../src/projects/projects.controller';
import { TrackingController } from '../../../src/tracking/tracking.controller';

/**
 * S23 : le ValidationPipe ne valide que les classes décorées. Ce test parcourt les métadonnées de
 * tous les contrôleurs HTTP et échoue si une entrée de requête échappe à toute validation :
 * `@Body()` typé par une interface ou un type inline (émis comme `Object`), `@Body('champ')`,
 * `@Param()` sans pipe, `@Query('champ')` sans pipe.
 */
const CONTROLLERS = [
  AdminController,
  AppController,
  AuthController,
  DevAuthController,
  ScimController,
  SsoController,
  NotesController,
  NotificationsController,
  AiController,
  CommentsController,
  GitHubWebhookController,
  InvitationsController,
  ProjectsController,
  TrackingController,
];

/**
 * Entrées volontairement non validées, avec leur raison. Vide : le webhook GitHub ne lit plus de
 * `@Body()` (corps brut vérifié par HMAC puis analysé par le service, r44-m1).
 */
const EXEMPT: Record<string, string> = {};
/**
 * SCIM : un identifiant inconnu doit rester un 404 au format SCIM (Entra le teste), pas un 400.
 * Seules les quatre routes d'identifiant SCIM sont exemptées ; les routes JWT de gestion des clés
 * (`workspaces/:workspaceId/scim/keys`) ont leur pipe (r44-a1).
 */
const PARAM_EXEMPT_METHODS = [
  'ScimController.getUser',
  'ScimController.updateUser',
  'ScimController.patchUser',
  'ScimController.deleteUser',
];

const PRIMITIVES: unknown[] = [Object, String, Number, Boolean, Array, undefined];

interface RouteArg {
  paramtype: RouteParamtypes;
  index: number;
  data?: string;
  pipes: unknown[];
  type: unknown;
  where: string;
}

function routeArgs(controller: { prototype: object; name: string }): RouteArg[] {
  const args: RouteArg[] = [];
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler = (controller.prototype as Record<string, unknown>)[name];
    if (
      typeof handler !== 'function' ||
      Reflect.getMetadata(METHOD_METADATA, handler) === undefined
    )
      continue;
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {};
    const types = Reflect.getMetadata('design:paramtypes', controller.prototype, name) ?? [];
    for (const [key, value] of Object.entries<{ index: number; data?: string; pipes: unknown[] }>(
      meta,
    )) {
      args.push({
        paramtype: Number(key.split(':')[0]),
        index: value.index,
        data: value.data as string | undefined,
        pipes: value.pipes ?? [],
        type: types[value.index],
        where: `${controller.name}.${name}`,
      });
    }
  }
  return args;
}

describe('S23 : toute entrée de requête passe par une validation', () => {
  const all = CONTROLLERS.flatMap(routeArgs);

  it('le parcours voit des centaines d’entrées (garde-fou contre un test vide)', () => {
    expect(all.length).toBeGreaterThan(150);
    expect(all.filter((a) => a.paramtype === RouteParamtypes.BODY).length).toBeGreaterThan(50);
  });

  it('@Body() : un DTO classe, jamais une interface, un type inline ni un champ isolé', () => {
    const offenders = all
      .filter((a) => a.paramtype === RouteParamtypes.BODY)
      .filter((a) => !(`${a.where}:body` in EXEMPT))
      .filter((a) => a.data !== undefined || PRIMITIVES.includes(a.type))
      .map(
        (a) =>
          `${a.where} (@Body(${a.data ? `'${a.data}'` : ''}) : ${(a.type as { name?: string })?.name})`,
      );
    expect(offenders).toEqual([]);
  });

  it('@Query() : un DTO classe, ou un pipe sur chaque paramètre isolé', () => {
    const offenders = all
      .filter((a) => a.paramtype === RouteParamtypes.QUERY)
      .filter((a) => (a.data === undefined ? PRIMITIVES.includes(a.type) : a.pipes.length === 0))
      .map((a) => `${a.where} (@Query(${a.data ? `'${a.data}'` : ''}))`);
    expect(offenders).toEqual([]);
  });

  it('@Param() : chaque identifiant d’URL a un pipe (UUID ou énumération)', () => {
    const offenders = all
      .filter((a) => a.paramtype === RouteParamtypes.PARAM)
      .filter((a) => !PARAM_EXEMPT_METHODS.includes(a.where))
      .filter((a) => a.pipes.length === 0)
      .map((a) => `${a.where} (:${a.data})`);
    expect(offenders).toEqual([]);
  });

  it('les exemptions SCIM désignent des méthodes qui existent (pas de contournement par renommage)', () => {
    for (const where of PARAM_EXEMPT_METHODS) expect(all.some((a) => a.where === where)).toBe(true);
  });

  it('les exemptions restent justifiées : elles désignent des entrées qui existent encore', () => {
    for (const key of Object.keys(EXEMPT)) {
      const [where] = key.split(':');
      expect(all.some((a) => a.where === where)).toBe(true);
    }
  });
});
