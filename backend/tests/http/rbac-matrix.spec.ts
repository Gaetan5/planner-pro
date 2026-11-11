/* eslint-disable @typescript-eslint/no-explicit-any */
import { INestApplication } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PolicyService } from '../../src/authz/policy.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { SessionService } from '../../src/auth/session.service';
import { TokenService } from '../../src/auth/token.service';
import { FirestoreSyncService } from '../../src/firestore-sync/firestore-sync.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { GeminiService } from '../../src/notes/gemini.service';
import { NotesService } from '../../src/notes/notes.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { FakeRedisService } from './fake-redis';
import { AiController } from '../../src/projects/ai.controller';
import { AiService } from '../../src/projects/ai.service';
import { CalendarSyncService } from '../../src/projects/calendar-sync.service';
import { CommentsController } from '../../src/projects/comments.controller';
import { CommentsService } from '../../src/projects/comments.service';
import { CopilotService } from '../../src/projects/copilot.service';
import { DependenciesService } from '../../src/projects/dependencies.service';
import { FinancesService } from '../../src/projects/finances.service';
import { IntegrationService } from '../../src/projects/integration.service';
import { MilestonesService } from '../../src/projects/milestones.service';
import { ProactiveSchedulerService } from '../../src/projects/proactive-scheduler.service';
import { ProjectPermissionsService } from '../../src/projects/project-permissions.service';
import { GitHubWebhookController } from '../../src/projects/github-webhook.controller';
import { GitHubWebhookService } from '../../src/projects/github-webhook.service';
import { ProjectsController } from '../../src/projects/projects.controller';
import { ProjectsService } from '../../src/projects/projects.service';
import { ResourcesService } from '../../src/projects/resources.service';
import { SprintService } from '../../src/projects/sprint.service';
import { TasksService } from '../../src/projects/tasks.service';
import { TimeBlocksService } from '../../src/projects/timeblocks.service';
import { RealtimeService } from '../../src/realtime/realtime.service';
import { TrackingController } from '../../src/tracking/tracking.controller';
import { TrackingService } from '../../src/tracking/tracking.service';
import { STUB_SID, sessionServiceStub } from '../support/session.test-support';
import { Persona, USERS, W, buildRbacPrisma, id } from '../support/rbac-fixture';
import { startHttpTestApp } from './http-test-app';

jest.setTimeout(120_000);

/**
 * S12-d : matrice RBAC PAR ROUTE sur une application Nest réelle (gardes globaux, contrôleurs et
 * services réels, politique réelle, Prisma simulé sur la fixture RBAC). Une ligne par route des
 * contrôleurs `projects`, `comments`, `tracking` et `ai` ; un test méta échoue si une route n'a pas
 * de ligne. L'oracle (qui peut quoi) est écrit ici, indépendamment de `permissions.ts`.
 */

// ─── Oracle indépendant ────────────────────────────────────────────────
const WS_ROLE: Record<Persona, string | null> = {
  owner: 'OWNER',
  admin: 'ADMIN',
  member: 'MEMBER',
  contributor: 'MEMBER',
  commenter: 'MEMBER',
  viewer: 'VIEWER',
  client: 'VIEWER',
  outsider: null, // membre d'un AUTRE workspace
  deprovisioned: null,
};
const PROJECT_ROLE: Partial<Record<Persona, string>> = {
  contributor: 'CONTRIBUTOR',
  commenter: 'COMMENTER',
  client: 'CLIENT',
  deprovisioned: 'CONTRIBUTOR', // sans Membership : ne compte pas
};
const RANK: Record<string, number> = { MANAGER: 4, CONTRIBUTOR: 3, COMMENTER: 2, CLIENT: 1 };
const PROJECT_MIN = {
  read: 'CLIENT',
  comment: 'COMMENTER',
  write: 'CONTRIBUTOR',
  manage: 'MANAGER',
} as const;
type ProjectLevel = keyof typeof PROJECT_MIN;
const WS_ROLES = {
  read: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  contribute: ['OWNER', 'ADMIN', 'MEMBER'],
  admin: ['OWNER', 'ADMIN'],
} as const;
type WsLevel = keyof typeof WS_ROLES;

const wsOk = (persona: Persona, level: WsLevel) =>
  WS_ROLES[level].includes(WS_ROLE[persona] as never);

/** Seul P1 porte des rôles de projet ; OWNER/ADMIN sont MANAGER de tout le workspace. */
function projectOk(persona: Persona, project: 'P1' | 'P2', level: ProjectLevel): boolean {
  if (WS_ROLE[persona] === null) return false; // S12-a : l'appartenance au workspace est requise
  if (WS_ROLE[persona] === 'OWNER' || WS_ROLE[persona] === 'ADMIN') return true;
  const role = project === 'P1' ? PROJECT_ROLE[persona] : undefined;
  return !!role && RANK[role] >= RANK[PROJECT_MIN[level]];
}

type Need =
  | { k: 'any' }
  | { k: 'public' }
  | { k: 'ws'; level: WsLevel }
  | { k: 'proj'; project: 'P1' | 'P2'; level: ProjectLevel }
  | { k: 'onlyIf'; allowed: Persona[] };

interface Row {
  need: Need;
  params?: Record<string, string>;
  query?: string;
  body?: unknown;
  multipart?: Record<string, string>;
  /** Pas de variante P1 (le corps référence une entité de P2). */
  noP1?: boolean;
  /** Statuts acceptables pour un refus (défaut : 403 ou 404). */
  denied?: number[];
  /** Route publique dont le handler répond lui-même 401 (signature absente) : message du handler. */
  own401?: string;
}

const TASK_P: Record<string, 'P1' | 'P2'> = { T1: 'P1', T2: 'P2' };
const proj = (project: 'P1' | 'P2', level: ProjectLevel): Need => ({ k: 'proj', project, level });
const ws = (level: WsLevel): Need => ({ k: 'ws', level });
const ANY: Need = { k: 'any' };
const DATE = '2026-06-01T10:00:00.000Z';
const DATE2 = '2026-06-01T12:00:00.000Z';

/** Une ligne par route. Les paramètres désignent des entités de la fixture (P1/P2, T1/T2, ...). */
const TABLE: Record<string, Row> = {
  // ── projects.controller : espaces et membres
  'GET /projects/workspaces': { need: ANY },
  'GET /projects/members': { need: ANY },
  'GET /projects/workspaces/:workspaceId/members': { need: ws('read'), params: { workspaceId: W } },
  'GET /projects/workspaces/:workspaceId/audit/logs': {
    need: ws('admin'),
    params: { workspaceId: W },
  },
  'GET /projects/:id/audit/logs': { need: proj('P2', 'manage'), params: { id: 'P2' } },
  'GET /projects/:id/members': { need: proj('P2', 'read'), params: { id: 'P2' } },
  'POST /projects/:id/members': {
    need: proj('P2', 'manage'),
    params: { id: 'P2' },
    body: { targetUserId: USERS.member, role: 'CLIENT' },
  },
  'DELETE /projects/:id/members/:userId': {
    need: proj('P2', 'manage'),
    params: { id: 'P2', userId: USERS.client },
  },
  'GET /projects/timeblocks/all': { need: ANY },
  // ── ressources (portée utilisateur/workspace)
  'GET /projects/resources/capacity': { need: ws('contribute'), query: `workspaceId=${W}` },
  'PUT /projects/resources/:userId/profile': {
    need: ws('admin'),
    params: { userId: USERS.member },
    query: `workspaceId=${W}`,
    body: { weeklyCapacityMinutes: 2400 },
  },
  'POST /projects/resources/:userId/leaves': {
    need: ANY,
    params: { userId: USERS.member },
    body: { startDate: DATE, endDate: DATE2 },
  },
  'GET /projects/resources/:userId/leaves': {
    need: ws('contribute'),
    params: { userId: USERS.member },
  },
  'DELETE /projects/resources/leaves/:leaveId': { need: ANY, params: { leaveId: 'L1' } },
  'POST /projects/:id/allocations': {
    need: ws('admin'),
    params: { id: 'P2' },
    body: { userId: USERS.member, allocationPercent: 50 },
    denied: [400, 403, 404],
  },
  // ── projets
  'POST /projects': { need: ws('contribute'), body: { name: 'Nouveau', workspaceId: W } },
  'GET /projects': { need: ANY },
  'GET /projects/:id': { need: proj('P2', 'read'), params: { id: 'P2' } },
  'PUT /projects/:id': { need: proj('P2', 'write'), params: { id: 'P2' }, body: { name: 'x' } },
  'DELETE /projects/:id': { need: proj('P2', 'manage'), params: { id: 'P2' } },
  // ── livraisons, jalons, livrables (S12-b)
  'GET /projects/:id/delivery-report': { need: proj('P2', 'read'), params: { id: 'P2' } },
  'POST /projects/:id/deliveries': {
    need: proj('P2', 'manage'),
    params: { id: 'P2' },
    body: { summary: 's', checklist: ['a'] },
    denied: [400, 403, 404],
  },
  'PUT /projects/deliveries/:deliveryId/status': {
    need: proj('P2', 'manage'),
    params: { deliveryId: 'D2' },
    body: { status: 'DELIVERED' },
    denied: [400, 403, 404],
  },
  'PUT /projects/deliveries/items/:itemId/toggle': {
    need: proj('P2', 'write'),
    params: { itemId: 'I2' },
    denied: [400, 403, 404],
  },
  'POST /projects/:id/milestones': {
    need: proj('P2', 'manage'),
    params: { id: 'P2' },
    body: { name: 'Jalon' },
    denied: [400, 403, 404],
  },
  'PUT /projects/milestones/:milestoneId/complete': {
    need: proj('P2', 'manage'),
    params: { milestoneId: 'M2' },
    denied: [400, 403, 404],
  },
  'POST /projects/:id/deliverables': {
    need: proj('P2', 'manage'),
    params: { id: 'P2' },
    body: { title: 'Livrable' },
    denied: [400, 403, 404],
  },
  'PUT /projects/deliverables/:deliverableId/status/:status': {
    need: proj('P2', 'manage'),
    params: { deliverableId: 'DL2', status: 'READY_FOR_REVIEW' },
    denied: [400, 403, 404],
  },
  // ── tâches
  'POST /projects/:id/tasks': {
    need: proj('P2', 'write'),
    params: { id: 'P2' },
    body: { title: 'Tâche' },
  },
  'GET /projects/:id/tasks': { need: proj('P2', 'read'), params: { id: 'P2' } },
  'GET /projects/:id/critical-path': { need: proj('P2', 'read'), params: { id: 'P2' } },
  'POST /projects/tasks/:taskId/dependencies': {
    need: proj('P2', 'write'),
    params: { taskId: 'T2' },
    body: { dependsOnTaskId: 'T2b' },
    denied: [400, 403, 404],
  },
  'DELETE /projects/tasks/:taskId/dependencies/:dependsOnTaskId': {
    need: proj('P2', 'write'),
    params: { taskId: 'T2', dependsOnTaskId: 'T2b' },
    denied: [400, 403, 404],
  },
  'PUT /projects/tasks/:taskId': {
    need: proj('P2', 'write'),
    params: { taskId: 'T2' },
    body: { title: 'x' },
  },
  'DELETE /projects/tasks/:taskId': { need: proj('P2', 'write'), params: { taskId: 'T2' } },
  'POST /projects/tasks/:taskId/timeblocks': {
    need: proj('P2', 'write'),
    params: { taskId: 'T2' },
    body: { startTime: DATE, endTime: DATE2 },
    denied: [400, 403, 404],
  },
  'PUT /projects/timeblocks/:timeBlockId': {
    need: proj('P2', 'write'),
    params: { timeBlockId: 'TB2' },
    body: { startTime: DATE, endTime: DATE2 },
    denied: [400, 403, 404],
  },
  'DELETE /projects/timeblocks/:timeBlockId': {
    need: proj('P2', 'write'),
    params: { timeBlockId: 'TB2' },
    denied: [400, 403, 404],
  },
  // ── webhook GitHub par projet (S21) : réception publique (signature), régénération `project.manage`
  'POST /projects/webhooks/github': { need: { k: 'public' }, body: {} },
  'POST /projects/:projectId/webhooks/github': {
    need: { k: 'public' },
    params: { projectId: 'P2' },
    body: {},
    own401: 'Webhook refusé.',
  },
  'POST /projects/:projectId/webhooks/github/secret': {
    need: proj('P2', 'manage'),
    params: { projectId: 'P2' },
    denied: [403, 404],
  },
  'POST /projects/workspaces/:workspaceId/resources/optimize': {
    need: ws('admin'),
    params: { workspaceId: W },
  },
  // ── intégrations et calendrier
  'GET /projects/workspaces/:workspaceId/integrations': {
    need: ws('contribute'),
    params: { workspaceId: W },
  },
  'GET /projects/workspaces/:workspaceId/integrations/status': {
    need: ws('contribute'),
    params: { workspaceId: W },
  },
  'POST /projects/workspaces/:workspaceId/integrations': {
    need: ws('admin'),
    params: { workspaceId: W },
    body: { type: 'SLACK', name: 'Canal' },
  },
  'POST /projects/integrations/:integrationId/toggle': {
    need: ws('admin'),
    params: { integrationId: 'INT1' },
  },
  'DELETE /projects/integrations/:integrationId': {
    need: ws('admin'),
    params: { integrationId: 'INT1' },
  },
  'POST /projects/workspaces/:workspaceId/integrations/:integrationId/export': {
    need: ws('admin'),
    params: { workspaceId: W, integrationId: 'INT1' },
  },
  'GET /projects/workspaces/:workspaceId/calendar-conflicts': {
    need: ws('read'),
    params: { workspaceId: W },
  },
  'GET /projects/workspaces/:workspaceId/calendar/oauth/google/auth-url': {
    need: ws('read'),
    params: { workspaceId: W },
  },
  'GET /projects/workspaces/:workspaceId/calendar/oauth/outlook/auth-url': {
    need: ws('read'),
    params: { workspaceId: W },
  },
  'POST /projects/workspaces/:workspaceId/calendar/oauth/callback': {
    need: ws('admin'),
    params: { workspaceId: W },
    body: { provider: 'GOOGLE_CALENDAR', code: 'x' },
  },
  'POST /projects/workspaces/:workspaceId/calendar/sync': {
    need: ws('admin'),
    params: { workspaceId: W },
  },
  'POST /projects/workspaces/:workspaceId/auto-schedule': {
    need: ws('contribute'),
    params: { workspaceId: W },
  },
  // ── sprints
  'POST /projects/workspaces/:workspaceId/sprints': {
    need: ws('contribute'),
    params: { workspaceId: W },
    body: { name: 'S', startDate: DATE, endDate: '2026-06-14T12:00:00.000Z' },
  },
  // P11 : les sprints, la capacité et les intégrations sont fermés à un VIEWER (niveau « contribute »)
  'GET /projects/workspaces/:workspaceId/sprints': {
    need: ws('contribute'),
    params: { workspaceId: W },
  },
  'PUT /projects/sprints/:sprintId': {
    need: ws('contribute'),
    params: { sprintId: 'S1' },
    body: { name: 'S bis' },
  },
  'DELETE /projects/sprints/:sprintId': { need: ws('contribute'), params: { sprintId: 'S1' } },
  'POST /projects/sprints/:sprintId/tasks': {
    // contribute au niveau workspace ET task.write sur P2 : seuls OWNER/ADMIN passent
    need: proj('P2', 'write'),
    params: { sprintId: 'S1' },
    body: { taskIds: ['2f1b3c4d-1111-4222-8333-444455557777'] },
    noP1: true,
  },
  'GET /projects/workspaces/:workspaceId/velocity': {
    need: ws('contribute'),
    params: { workspaceId: W },
  },
  'GET /projects/sprints/:sprintId/burndown': {
    need: ws('contribute'),
    params: { sprintId: 'S1' },
  },
  'GET /projects/workspaces/:workspaceId/finances': {
    need: ws('admin'),
    params: { workspaceId: W },
  },
  // ── comments.controller
  'POST /projects/tasks/:taskId/comments': {
    need: proj('P2', 'comment'),
    params: { taskId: 'T2' },
    body: { content: 'Bonjour' },
  },
  'GET /projects/tasks/:taskId/comments': { need: proj('P2', 'read'), params: { taskId: 'T2' } },
  'DELETE /projects/comments/:commentId': {
    // C2 (P2) : auteur = owner ; un MANAGER (OWNER/ADMIN) peut supprimer
    need: { k: 'onlyIf', allowed: ['owner', 'admin'] },
    params: { commentId: 'C2' },
  },
  'PUT /projects/comments/:commentId': {
    need: { k: 'onlyIf', allowed: ['owner'] },
    params: { commentId: 'C2' },
    body: { content: 'modifié' },
  },
  'POST /projects/tasks/:taskId/attachments': {
    need: proj('P2', 'comment'),
    params: { taskId: 'T2' },
    body: {
      fileName: 'f.png',
      fileUrl: 'data:image/png;base64,AA==',
      fileType: 'image/png',
      fileSize: 1,
    },
  },
  'GET /projects/tasks/:taskId/attachments': { need: proj('P2', 'read'), params: { taskId: 'T2' } },
  'DELETE /projects/attachments/:attachmentId': {
    need: { k: 'onlyIf', allowed: ['owner', 'admin'] },
    params: { attachmentId: 'A2' },
  },
  // ── tracking.controller
  'GET /tracking/active': { need: ANY },
  'POST /tracking/start/:taskId': {
    need: proj('P2', 'write'),
    params: { taskId: 'T2' },
    denied: [400, 403, 404],
  },
  'POST /tracking/stop': { need: ANY },
  'GET /tracking/logs': { need: ANY },
  'GET /tracking/logs/:taskId': {
    need: proj('P2', 'write'),
    params: { taskId: 'T2' },
    denied: [400, 403, 404],
  },
  // ── ai.controller
  'POST /projects/ai/command': {
    need: ws('contribute'),
    body: { command: 'créer tâche x', workspaceId: W },
  },
  'POST /projects/ai/voice': { need: ws('contribute'), multipart: { workspaceId: W } },
  'POST /projects/ai/execute': { need: ws('contribute'), body: { workspaceId: W, actions: [] } },
  'POST /projects/ai/vision': { need: ws('contribute'), multipart: { workspaceId: W } },
  'GET /projects/ai/copilot/alerts': { need: ws('read'), query: `workspaceId=${W}` },
  'GET /projects/ai/copilot/briefing': { need: ws('read'), query: `workspaceId=${W}` },
};

const P1_IDS: Record<string, string> = {
  P2: 'P1',
  T2: 'T1',
  D2: 'D1',
  I2: 'I1',
  M2: 'M1',
  DL2: 'DL1',
  TB2: 'TB1',
};
/** Variante P1 d'une ligne de projet : les profils qui ont un rôle sur P1 y accèdent (S12-a). */
function p1Variant(row: Row): Row {
  const need = row.need as Extract<Need, { k: 'proj' }>;
  return {
    ...row,
    need: { ...need, project: 'P1' },
    params: Object.fromEntries(
      Object.entries(row.params ?? {}).map(([k, v]) => [k, P1_IDS[v] ?? v]),
    ),
  };
}

function isAllowed(persona: Persona, row: Row): boolean | null {
  const need = row.need;
  switch (need.k) {
    case 'any':
    case 'public':
      return null; // pas de matrice : seule l'absence de 401 compte
    case 'ws':
      return wsOk(persona, need.level);
    case 'proj':
      return projectOk(persona, need.project, need.level);
    case 'onlyIf':
      return need.allowed.includes(persona);
  }
}

// ─── Inventaire des routes ─────────────────────────────────────────────
function routesOf(controllers: { prototype: object }[]): string[] {
  const keys: string[] = [];
  for (const controller of controllers) {
    const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const full = `/${[prefix, path].filter(Boolean).join('/')}`
        .replace(/\/+/g, '/')
        .replace(/(.)\/$/, '$1');
      keys.push(`${RequestMethod[method]} ${full}`);
    }
  }
  return keys;
}
const CONTROLLERS = [
  ProjectsController,
  GitHubWebhookController,
  CommentsController,
  TrackingController,
  AiController,
];

describe('S12-d : matrice RBAC par route (HTTP)', () => {
  it('méta : chaque route des contrôleurs projects, comments, tracking et ai a une ligne', () => {
    const routes = routesOf(CONTROLLERS);
    expect(routes.length).toBeGreaterThan(70);
    expect(routes.filter((r) => !(r in TABLE))).toEqual([]);
    expect(Object.keys(TABLE).filter((k) => !routes.includes(k))).toEqual([]);
  });

  describe('exécution', () => {
    const JWT_SECRET = 'test-secret-rbac-matrix-0123456789abcdef0123';
    let app: INestApplication;
    let baseUrl: string;
    const tokens = {} as Record<Persona, string>;
    const writes: string[] = [];
    const savedEnv = { ...process.env };

    /** Prisma simulé : fixture RBAC + entités annexes par identifiant ; écritures enregistrées. */
    function buildPrisma() {
      const base = buildRbacPrisma() as any;
      const project = (id: string) => base.data.projects.find((p: any) => p.id === id);
      const delivery = (id: string, pid: string) => ({
        id,
        projectId: pid,
        project: project(pid),
        checklist: [],
        summary: `Livraison ${pid}`,
      });
      const extras: Record<string, Record<string, any>> = {
        deliveryRecord: { D1: delivery(id('D1'), id('P1')), D2: delivery(id('D2'), id('P2')) },
        deliveryChecklistItem: {
          [id('I1')]: {
            id: id('I1'),
            deliveryId: id('D1'),
            delivery: delivery(id('D1'), id('P1')),
          },
          [id('I2')]: {
            id: id('I2'),
            deliveryId: id('D2'),
            delivery: delivery(id('D2'), id('P2')),
          },
        },
        milestone: {
          [id('M1')]: { id: id('M1'), projectId: id('P1'), project: project(id('P1')) },
          [id('M2')]: { id: id('M2'), projectId: id('P2'), project: project(id('P2')) },
        },
        deliverable: {
          [id('DL1')]: { id: id('DL1'), projectId: id('P1'), project: project(id('P1')) },
          [id('DL2')]: { id: id('DL2'), projectId: id('P2'), project: project(id('P2')) },
        },
        timeBlock: {
          [id('TB1')]: {
            id: id('TB1'),
            taskId: id('T1'),
            startTime: new Date(),
            endTime: new Date(),
          },
          [id('TB2')]: {
            id: id('TB2'),
            taskId: id('T2'),
            startTime: new Date(),
            endTime: new Date(),
          },
        },
        sprint: {
          [id('S1')]: {
            id: id('S1'),
            workspaceId: W,
            name: 'S',
            status: 'PLANNED',
            startDate: new Date('2026-06-01'),
            endDate: new Date('2026-06-14'),
          },
        },
        integration: {
          [id('INT1')]: {
            id: id('INT1'),
            workspaceId: W,
            type: 'SLACK',
            name: 'Canal',
            active: true,
          },
        },
        comment: {
          [id('C1')]: {
            id: id('C1'),
            taskId: id('T1'),
            userId: USERS.contributor,
            content: 'c1',
            task: { ...base.data.tasks[0], project: project(id('P1')) },
          },
          [id('C2')]: {
            id: id('C2'),
            taskId: id('T2'),
            userId: USERS.owner,
            content: 'Tâche 2 secret',
            task: { ...base.data.tasks[1], project: project(id('P2')) },
          },
        },
        attachment: {
          [id('A1')]: {
            id: id('A1'),
            taskId: id('T1'),
            uploadedById: USERS.contributor,
            task: { ...base.data.tasks[0], project: project(id('P1')) },
          },
          [id('A2')]: {
            id: id('A2'),
            taskId: id('T2'),
            uploadedById: USERS.owner,
            task: { ...base.data.tasks[1], project: project(id('P2')) },
          },
        },
      };
      // Tâche supplémentaire de P2 (cible de dépendance)
      base.data.tasks.push(
        {
          id: id('T2b'),
          title: 'Tâche 2b',
          projectId: id('P2'),
          userId: USERS.owner,
          deletedAt: null,
        },
        {
          id: '2f1b3c4d-1111-4222-8333-444455557777',
          title: 'Tâche 2 uuid',
          projectId: id('P2'),
          userId: USERS.owner,
          deletedAt: null,
        },
      );
      extras.taskDependency = {
        '*': {
          id: 'dep1',
          taskId: id('T2'),
          dependsOnTaskId: id('T2b'),
          task: { deletedAt: null },
        },
      };
      const WRITE = /^(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;
      const model = (name: string) =>
        new Proxy(base[name] ?? {}, {
          get(target, method: string) {
            if (WRITE.test(method)) {
              return async (args: any) => {
                writes.push(`${name}.${method}`);
                return { id: 'new', ...(args?.data ?? {}), ...(args?.where ?? {}) };
              };
            }
            if (method in target) return target[method];
            if (/^find(First|Unique|UniqueOrThrow)$/.test(method)) {
              return async (args: any) =>
                extras[name]?.[args?.where?.id] ?? extras[name]?.['*'] ?? null;
            }
            if (method === 'findMany') return async () => [];
            if (method === 'count') return async () => 0;
            return async () => null;
          },
        });
      const proxy: any = new Proxy(base, {
        get(target, name: string) {
          // La transaction rejoue le même Prisma simulé : les écritures y sont aussi enregistrées
          if (name === '$transaction') return async (cb: any) => cb(proxy);
          if (name === 'data') return target.data;
          return model(name);
        },
      });
      return proxy;
    }

    beforeAll(async () => {
      process.env.JWT_SECRET = JWT_SECRET;
      const jwtService = new JwtService({ secret: JWT_SECRET });
      const prisma = buildPrisma();
      const tokenService = new TokenService(jwtService);
      for (const persona of Object.keys(USERS) as Persona[]) {
        tokens[persona] = tokenService.signAccessToken({
          sub: USERS[persona],
          email: `${persona}@x.com`,
          sid: STUB_SID,
        });
      }
      ({ app, baseUrl } = await startHttpTestApp({
        controllers: CONTROLLERS,
        providers: [
          ProjectsService,
          GitHubWebhookService,
          { provide: RedisService, useValue: new FakeRedisService() },
          TasksService,
          DependenciesService,
          TimeBlocksService,
          MilestonesService,
          ResourcesService,
          FinancesService,
          ProjectPermissionsService,
          SprintService,
          CommentsService,
          TrackingService,
          IntegrationService,
          CalendarSyncService,
          ProactiveSchedulerService,
          CopilotService,
          AiService,
          PolicyService,
          RealtimeService,
          {
            provide: 'AI_PROVIDER',
            useValue: {
              isAvailable: () => false,
              parseCommand: async () => [],
              analyzeImage: async () => [],
              transcribeAudio: async () => '',
            },
          },
          { provide: GeminiService, useValue: { isAvailable: () => false } },
          { provide: NotesService, useValue: {} },
          { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
          { provide: FirestoreSyncService, useValue: { enqueue: jest.fn() } },
          { provide: PrismaService, useValue: prisma },
          { provide: JwtService, useValue: jwtService },
          TokenService,
          {
            provide: SessionService,
            useFactory: (t: TokenService) => sessionServiceStub(t),
            inject: [TokenService],
          },
          JwtAuthGuard,
        ],
      }));
    });

    afterAll(async () => {
      await app.close();
      process.env = savedEnv;
    });

    const personas = Object.keys(USERS) as Persona[];
    const VARIANT = ' [P1]';
    /** Les identifiants logiques de la table (P2, T2...) deviennent des UUID : l'URL l'exige (S23). */
    const LOGICAL_ID =
      /^(?:P[123X]|T[12X]b?|S1|TB[12]|INT1|[DI][12]|DL[12]|[CM][12]|A[12]|L1|ws-[12])$/;
    const toUuid = (value: any): any =>
      typeof value === 'string'
        ? LOGICAL_ID.test(value)
          ? id(value)
          : value
        : Array.isArray(value)
          ? value.map(toUuid)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toUuid(v)]))
            : value;
    const tableRow = (key: string): Row =>
      key.endsWith(VARIANT) ? p1Variant(TABLE[key.slice(0, -VARIANT.length)]) : TABLE[key];
    const keys = [
      ...Object.keys(TABLE),
      ...Object.entries(TABLE)
        .filter(([, row]) => row.need.k === 'proj' && !row.noP1)
        .map(([key]) => key + VARIANT),
    ];
    const cases = keys.flatMap((key) => personas.map((persona) => [key, persona] as const));

    async function call(key: string, persona: Persona) {
      const row = tableRow(key);
      const [method, template] = key.replace(VARIANT, '').split(' ');
      const path = template.replace(/:([A-Za-z]+)/g, (_m, name) =>
        toUuid(row.params?.[name] ?? name),
      );
      const url = `${baseUrl}${path}${row.query ? `?${row.query}` : ''}`;
      const headers: Record<string, string> = { Authorization: `Bearer ${tokens[persona]}` };
      let body: BodyInit | undefined;
      if (row.multipart) {
        const form = new FormData();
        form.append('file', new Blob(['x'], { type: 'audio/webm' }), 'a.webm');
        for (const [k, v] of Object.entries(row.multipart)) form.append(k, v);
        body = form;
      } else if (row.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(toUuid(row.body));
      }
      writes.length = 0;
      const res = await fetch(url, { method, headers, body });
      return { status: res.status, text: await res.text(), writes: [...writes] };
    }

    it.each(cases)('%s : %s', async (key, persona) => {
      const row = tableRow(key);
      const allowed = isAllowed(persona, row);
      const result = await call(key, persona);

      // Aucune donnée de P2 ne doit sortir pour un profil qui n'y a pas accès en lecture
      if (!projectOk(persona, 'P2', 'read')) {
        expect(result.text).not.toMatch(/Projet 2|Tâche 2|Livraison P2/);
      }
      if (allowed === null) {
        if (row.own401 && result.status === 401) {
          // 401 du handler (signature), pas du garde d'authentification
          expect(result.text).toContain(row.own401);
          return;
        }
        expect(result.status).not.toBe(401);
        return;
      }
      if (allowed) {
        expect([401, 403]).not.toContain(result.status);
      } else {
        const accepted = row.denied ?? [403, 404];
        if (!accepted.includes(result.status)) {
          throw new Error(
            `${key} (${persona}) : statut ${result.status} au lieu de ${accepted.join('/')} : ${result.text.slice(0, 160)}`,
          );
        }
        expect(result.writes).toEqual([]);
      }
    });
  });
});
