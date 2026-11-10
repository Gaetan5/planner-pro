/* eslint-disable @typescript-eslint/no-explicit-any */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import { PolicyService } from '../../src/authz/policy.service';
import { decrypt, encrypt } from '../../src/auth/encryption.util';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { SessionService } from '../../src/auth/session.service';
import { TokenService } from '../../src/auth/token.service';
import { FirestoreSyncService } from '../../src/firestore-sync/firestore-sync.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { NotesService } from '../../src/notes/notes.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GitHubWebhookController } from '../../src/projects/github-webhook.controller';
import {
  GitHubWebhookService,
  WEBHOOK_DELIVERY_TTL_SECONDS,
  WEBHOOK_REDIS_TIMEOUT_TOKEN,
} from '../../src/projects/github-webhook.service';
import { IntegrationService } from '../../src/projects/integration.service';
import { ProjectPermissionsService } from '../../src/projects/project-permissions.service';
import { TasksService } from '../../src/projects/tasks.service';
import { RealtimeService } from '../../src/realtime/realtime.service';
import { RedisService } from '../../src/redis/redis.service';
import { Persona, USERS, W, buildRbacPrisma } from '../support/rbac-fixture';
import { STUB_SID, sessionServiceStub } from '../support/session.test-support';
import { FakeRedisService } from './fake-redis';
import { startHttpTestApp } from './http-test-app';

jest.setTimeout(30_000);

/** S21 : webhook GitHub par projet (HTTP, application Nest réelle, Prisma et Redis simulés). */
describe('S21 : webhook GitHub par projet', () => {
  const JWT_SECRET = 'test-secret-s21-0123456789abcdef0123456789abcdef';
  const REFUSED = 'Webhook refusé.';
  const TASK_P2 = '2f1b3c4d-1111-4222-8333-444455556666'; // tâche de P2
  const TASK_P1 = '9a8b7c6d-1111-4222-8333-444455557777'; // tâche de P1 (autre projet)
  const SECRET_P2 = 'c2'.repeat(32);
  const SECRET_P1 = 'c1'.repeat(32);
  const savedEnv = { ...process.env };

  let app: INestApplication;
  let baseUrl: string;
  let prisma: any;
  let redis: FakeRedisService;
  let failNextTaskUpdate = false;
  const audit: any[] = [];
  const tokens = {} as Record<Persona, string>;
  let impersonationToken: string;

  const sign = (secret: string, body: string) =>
    'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const task = (id: string) => prisma.data.tasks.find((t: any) => t.id === id);

  /** Corps JSON volontairement espacé : seule une signature sur le corps brut est valide. */
  const pushBody = (message: string, repo = 'Acme/Web') =>
    `{ "ref": "refs/heads/main",\n  "repository": { "full_name": "${repo}" },\n  "commits": [ { "message": "${message}" } ] }\n`;

  async function deliver(
    projectId: string,
    body: string,
    opts: { secret?: string; delivery?: string | null; signature?: string | null } = {},
  ) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const signature =
      opts.signature === undefined ? sign(opts.secret ?? SECRET_P2, body) : opts.signature;
    if (signature !== null) headers['X-Hub-Signature-256'] = signature;
    const delivery = opts.delivery === undefined ? 'd-0001-aaaa-bbbb' : opts.delivery;
    if (delivery !== null) headers['X-GitHub-Delivery'] = delivery;
    const res = await fetch(`${baseUrl}/projects/${projectId}/webhooks/github`, {
      method: 'POST',
      headers,
      body,
    });
    return { status: res.status, text: await res.text() };
  }

  const regenerate = (projectId: string, persona?: Persona) =>
    fetch(`${baseUrl}/projects/${projectId}/webhooks/github/secret`, {
      method: 'POST',
      headers: persona ? { Authorization: `Bearer ${tokens[persona]}` } : {},
    }).then(async (res) => ({ status: res.status, text: await res.text() }));

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.ENCRYPTION_KEY = 'super-secret-key-32-bytes-long!!';
    const jwtService = new JwtService({ secret: JWT_SECRET });
    const tokenService = new TokenService(jwtService);
    for (const persona of Object.keys(USERS) as Persona[]) {
      tokens[persona] = tokenService.signAccessToken({
        sub: USERS[persona],
        email: `${persona}@x.com`,
        sid: STUB_SID,
      });
    }
    // Session d'impersonation (S18) : un administrateur agit au nom du propriétaire
    impersonationToken = tokenService.signAccessToken({
      sub: USERS.owner,
      email: 'owner@x.com',
      sid: STUB_SID,
      impersonatedBy: 'platform-admin-1',
    });
    redis = new FakeRedisService();
    ({ app, baseUrl } = await startHttpTestApp({
      controllers: [GitHubWebhookController],
      providers: [
        GitHubWebhookService,
        TasksService,
        ProjectPermissionsService,
        PolicyService,
        { provide: RedisService, useValue: redis },
        { provide: WEBHOOK_REDIS_TIMEOUT_TOKEN, useValue: 200 },
        { provide: RealtimeService, useValue: { isReady: false, refreshUserRooms: jest.fn() } },
        { provide: NotesService, useValue: { syncTaskStatusToNote: jest.fn() } },
        { provide: IntegrationService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: FirestoreSyncService, useValue: { enqueue: jest.fn() } },
        {
          provide: PrismaService,
          useFactory: () => {
            prisma = buildRbacPrisma();
            return prisma;
          },
        },
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
    prisma.project.update = jest.fn(async ({ where, data }: any) => {
      const row = prisma.data.projects.find((p: any) => p.id === where.id);
      Object.assign(row, data);
      return row;
    });
    prisma.task.update = jest.fn(async ({ where, data }: any) => {
      if (failNextTaskUpdate) {
        failNextTaskUpdate = false;
        throw new Error('base indisponible');
      }
      const row = prisma.data.tasks.find((t: any) => t.id === where.id);
      Object.assign(row, data);
      return row;
    });
    prisma.auditLog = {
      create: jest.fn(async ({ data }: any) => {
        audit.push(data);
        return data;
      }),
    };
  });

  beforeEach(() => {
    const { projects, tasks } = prisma.data;
    for (const p of projects) {
      p.githubRepo = null;
      p.githubWebhookSecret = null;
      p.deletedAt = null;
    }
    const byId = (id: string) => projects.find((p: any) => p.id === id);
    byId('P1').githubRepo = 'Acme/Api';
    byId('P1').githubWebhookSecret = encrypt(SECRET_P1);
    byId('P2').githubRepo = 'Acme/Web';
    byId('P2').githubWebhookSecret = encrypt(SECRET_P2);
    // P3 : créé par un simple MEMBER (propriétaire du projet, sans être admin du workspace)
    const p3 = projects.findIndex((p: any) => p.id === 'P3');
    if (p3 >= 0) projects.splice(p3, 1);
    projects.push({
      id: 'P3',
      name: 'Projet 3',
      userId: USERS.member,
      workspaceId: W,
      githubRepo: 'Acme/Web3',
      githubWebhookSecret: encrypt('c3'.repeat(32)),
      deletedAt: null,
    });
    for (const id of [TASK_P1, TASK_P2]) {
      const i = tasks.findIndex((t: any) => t.id === id);
      if (i >= 0) tasks.splice(i, 1);
    }
    tasks.push(
      {
        id: TASK_P2,
        title: 'T P2',
        projectId: 'P2',
        status: 'TODO',
        noteId: null,
        deletedAt: null,
      },
      {
        id: TASK_P1,
        title: 'T P1',
        projectId: 'P1',
        status: 'TODO',
        noteId: null,
        deletedAt: null,
      },
    );
    redis.store.clear();
    redis.ttls.length = 0;
    redis.mode = 'ok';
    redis.delRequests.length = 0;
    audit.length = 0;
    failNextTaskUpdate = false;
    prisma.task.update.mockClear();
    prisma.project.update.mockClear();
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  describe('réception', () => {
    it('ferme la tâche du projet quand la signature est calculée sur le corps brut (avec espaces)', async () => {
      const res = await deliver('P2', pushBody(`fixes #${TASK_P2}`));
      expect(res.status).toBe(201);
      expect(JSON.parse(res.text)).toEqual({ closedTaskIds: [TASK_P2] });
      expect(task(TASK_P2).status).toBe('DONE');
    });

    it('ferme la tâche d’une PR fusionnée qui référence « closes #uuid »', async () => {
      const body = `{ "action": "closed", "repository": { "full_name": "acme/web" },
        "pull_request": { "merged": true, "title": "t", "body": "closes #${TASK_P2}" } }`;
      const res = await deliver('P2', body);
      expect(JSON.parse(res.text).closedTaskIds).toEqual([TASK_P2]);
    });

    it('ne ferme rien pour une PR fermée sans fusion', async () => {
      const body = `{ "action": "closed", "repository": { "full_name": "Acme/Web" },
        "pull_request": { "merged": false, "title": "t", "body": "closes #${TASK_P2}" } }`;
      const res = await deliver('P2', body);
      expect(JSON.parse(res.text).closedTaskIds).toEqual([]);
      expect(task(TASK_P2).status).toBe('TODO');
    });

    it('accepte un ping (aucune tâche à fermer)', async () => {
      const res = await deliver('P2', `{ "zen": "ok", "repository": { "full_name": "Acme/Web" } }`);
      expect(res.status).toBe(201);
      expect(JSON.parse(res.text).closedTaskIds).toEqual([]);
    });

    it('ne ferme PAS la tâche d’un autre projet référencée dans un commit', async () => {
      const res = await deliver('P2', pushBody(`fixes #${TASK_P1}`));
      expect(res.status).toBe(201);
      expect(JSON.parse(res.text).closedTaskIds).toEqual([]);
      expect(task(TASK_P1).status).toBe('TODO');
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('refuse un dépôt différent de celui du projet, même avec une signature valide', async () => {
      const res = await deliver('P2', pushBody(`fixes #${TASK_P2}`, 'evil/other'));
      expect(res.status).toBe(401);
      expect(res.text).toContain(REFUSED);
      expect(task(TASK_P2).status).toBe('TODO');
    });

    it('refuse une charge utile sans dépôt', async () => {
      const body = `{ "commits": [ { "message": "fixes #${TASK_P2}" } ] }`;
      expect((await deliver('P2', body)).status).toBe(401);
      expect(task(TASK_P2).status).toBe('TODO');
    });

    it('refuse un projet sans dépôt lié', async () => {
      prisma.data.projects.find((p: any) => p.id === 'P2').githubRepo = null;
      expect((await deliver('P2', pushBody(`fixes #${TASK_P2}`))).status).toBe(401);
    });
  });

  describe('401 uniforme', () => {
    const body = () => pushBody(`fixes #${TASK_P2}`);
    const cases: Array<[string, () => Promise<{ status: number; text: string }>]> = [
      ['signature fausse', () => deliver('P2', body(), { signature: 'sha256=' + '0'.repeat(64) })],
      ['signature absente', () => deliver('P2', body(), { signature: null })],
      ['signature mal formée', () => deliver('P2', body(), { signature: 'sha256=zz' })],
      ['secret d’un autre projet', () => deliver('P2', body(), { secret: SECRET_P1 })],
      ['projet inconnu', () => deliver('inconnu', body())],
      [
        'projet supprimé',
        async () => {
          prisma.data.projects.find((p: any) => p.id === 'P2').deletedAt = new Date();
          return deliver('P2', body());
        },
      ],
      [
        'projet sans secret',
        async () => {
          prisma.data.projects.find((p: any) => p.id === 'P2').githubWebhookSecret = null;
          return deliver('P2', body());
        },
      ],
      [
        'secret chiffré illisible',
        async () => {
          prisma.data.projects.find((p: any) => p.id === 'P2').githubWebhookSecret =
            'pas:chiffre:du-tout';
          return deliver('P2', body());
        },
      ],
      ['identifiant de livraison absent', () => deliver('P2', body(), { delivery: null })],
      ['identifiant de livraison invalide', () => deliver('P2', body(), { delivery: 'a b/c' })],
    ];

    it.each(cases)('%s : 401 au message identique, rien de fermé', async (_label, run) => {
      const res = await run();
      expect(res.status).toBe(401);
      expect(JSON.parse(res.text).message).toBe(REFUSED);
      expect(task(TASK_P2).status).toBe('TODO');
      expect(redis.store.size).toBe(0);
    });
  });

  describe('anti-rejeu', () => {
    it('ignore le second envoi du même X-GitHub-Delivery', async () => {
      const body = pushBody(`fixes #${TASK_P2}`);
      const first = await deliver('P2', body, { delivery: 'delivery-1111' });
      expect(JSON.parse(first.text).closedTaskIds).toEqual([TASK_P2]);
      task(TASK_P2).status = 'TODO'; // si le rejeu était traité, la tâche serait refermée
      prisma.task.update.mockClear();
      const second = await deliver('P2', body, { delivery: 'delivery-1111' });
      expect(second.status).toBe(201);
      expect(JSON.parse(second.text).closedTaskIds).toEqual([]);
      expect(prisma.task.update).not.toHaveBeenCalled();
      expect(task(TASK_P2).status).toBe('TODO');
    });

    it('traite une autre livraison', async () => {
      const body = pushBody(`fixes #${TASK_P2}`);
      await deliver('P2', body, { delivery: 'delivery-1111' });
      task(TASK_P2).status = 'TODO';
      const other = await deliver('P2', body, { delivery: 'delivery-2222' });
      expect(JSON.parse(other.text).closedTaskIds).toEqual([TASK_P2]);
    });

    it('mémorise la livraison 24 h, par projet', async () => {
      await deliver('P2', pushBody(`fixes #${TASK_P2}`), { delivery: 'delivery-1111' });
      expect(WEBHOOK_DELIVERY_TTL_SECONDS).toBe(86_400);
      expect(redis.ttls).toEqual([
        { key: 'github-webhook:P2:delivery-1111', ttl: WEBHOOK_DELIVERY_TTL_SECONDS },
      ]);
    });

    it('une livraison refusée (signature fausse) ne consomme pas l’identifiant', async () => {
      const body = pushBody(`fixes #${TASK_P2}`);
      await deliver('P2', body, {
        delivery: 'delivery-1111',
        signature: 'sha256=' + '0'.repeat(64),
      });
      const ok = await deliver('P2', body, { delivery: 'delivery-1111' });
      expect(JSON.parse(ok.text).closedTaskIds).toEqual([TASK_P2]);
    });

    it('un traitement en échec libère l’identifiant : la nouvelle livraison est traitée', async () => {
      const body = pushBody(`fixes #${TASK_P2}`);
      failNextTaskUpdate = true;
      expect((await deliver('P2', body, { delivery: 'delivery-1111' })).status).toBe(500);
      const retry = await deliver('P2', body, { delivery: 'delivery-1111' });
      expect(JSON.parse(retry.text).closedTaskIds).toEqual([TASK_P2]);
    });

    it('SET abouti mais réponse perdue : 503, clé supprimée, un « Redeliver » est traité (r40-m2)', async () => {
      const body = pushBody(`fixes #${TASK_P2}`);
      redis.mode = 'write-then-mute';
      const lost = await deliver('P2', body, { delivery: 'delivery-1111' });
      expect(lost.status).toBe(503);
      expect(redis.delRequests).toEqual(['github-webhook:P2:delivery-1111']);
      expect(redis.store.has('github-webhook:P2:delivery-1111')).toBe(false);
      redis.mode = 'ok';
      const redelivered = await deliver('P2', body, { delivery: 'delivery-1111' });
      expect(JSON.parse(redelivered.text).closedTaskIds).toEqual([TASK_P2]);
    });

    it('Redis muet y compris pour la suppression : 503 en temps borné (2 délais au plus)', async () => {
      redis.mode = 'hang';
      const started = Date.now();
      const res = await deliver('P2', pushBody(`fixes #${TASK_P2}`));
      expect(res.status).toBe(503);
      expect(redis.delRequests).toHaveLength(1); // nettoyage tenté
      expect(Date.now() - started).toBeLessThan(1500); // délai de test 200 ms, deux appels
    });

    it('Redis en erreur : la suppression échoue aussi, 503 inchangé', async () => {
      redis.mode = 'reject';
      const res = await deliver('P2', pushBody(`fixes #${TASK_P2}`));
      expect(res.status).toBe(503);
      expect(redis.delRequests).toHaveLength(1);
    });

    it('un rejeu normal (clé déjà posée) ne déclenche aucune suppression', async () => {
      const body = pushBody(`fixes #${TASK_P2}`);
      await deliver('P2', body, { delivery: 'delivery-1111' });
      await deliver('P2', body, { delivery: 'delivery-1111' });
      expect(redis.delRequests).toEqual([]);
    });

    it.each(['reject', 'hang'] as const)(
      'Redis indisponible (%s) : livraison refusée en 503, rien de fermé',
      async (mode) => {
        redis.mode = mode;
        const res = await deliver('P2', pushBody(`fixes #${TASK_P2}`));
        expect(res.status).toBe(503);
        expect(task(TASK_P2).status).toBe('TODO');
        expect(prisma.task.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('ancienne route à secret global', () => {
    it.each([true, false])('répond 410 Gone (signature présente : %s)', async (signed) => {
      const body = pushBody(`fixes #${TASK_P2}`);
      const res = await fetch(`${baseUrl}/projects/webhooks/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signed ? { 'X-Hub-Signature-256': sign(SECRET_P2, body) } : {}),
        },
        body,
      });
      expect(res.status).toBe(410);
      expect(await res.text()).toContain('/projects/<id-du-projet>/webhooks/github');
      expect(task(TASK_P2).status).toBe('TODO');
    });
  });

  describe('régénération du secret (project.manage)', () => {
    it.each<[Persona, string]>([
      ['owner', 'propriétaire et OWNER de l’espace'],
      ['admin', 'ADMIN de l’espace'],
    ])('%s (%s) obtient un nouveau secret, chiffré en base', async (persona) => {
      const before = prisma.data.projects.find((p: any) => p.id === 'P2').githubWebhookSecret;
      const res = await regenerate('P2', persona);
      expect(res.status).toBe(201);
      const { webhookSecret } = JSON.parse(res.text);
      expect(webhookSecret).toMatch(/^[0-9a-f]{64}$/);
      const stored = prisma.data.projects.find((p: any) => p.id === 'P2').githubWebhookSecret;
      expect(stored).not.toBe(before);
      expect(stored).not.toContain(webhookSecret);
      expect(decrypt(stored)).toBe(webhookSecret);
    });

    it('le propriétaire du projet, simple MEMBER de l’espace, peut régénérer', async () => {
      expect((await regenerate('P3', 'member')).status).toBe(201);
    });

    it('l’ancien secret est invalidé immédiatement, le nouveau fonctionne', async () => {
      const { webhookSecret } = JSON.parse((await regenerate('P2', 'admin')).text);
      const body = pushBody(`fixes #${TASK_P2}`);
      expect((await deliver('P2', body, { secret: SECRET_P2 })).status).toBe(401);
      const ok = await deliver('P2', body, { secret: webhookSecret });
      expect(JSON.parse(ok.text).closedTaskIds).toEqual([TASK_P2]);
    });

    it.each<Persona>([
      'member',
      'contributor',
      'commenter',
      'viewer',
      'client',
      'outsider',
      'deprovisioned',
    ])('%s ne peut pas régénérer le secret de P2 (403/404), secret inchangé', async (persona) => {
      const before = prisma.data.projects.find((p: any) => p.id === 'P2').githubWebhookSecret;
      const res = await regenerate('P2', persona);
      expect([403, 404]).toContain(res.status);
      expect(res.text).not.toMatch(/[0-9a-f]{64}/);
      expect(prisma.data.projects.find((p: any) => p.id === 'P2').githubWebhookSecret).toBe(before);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it.each<Persona>(['contributor', 'commenter', 'client'])(
      '%s a un rôle sur P1 mais pas MANAGER : régénération refusée (403), secret inchangé',
      async (persona) => {
        const before = prisma.data.projects.find((p: any) => p.id === 'P1').githubWebhookSecret;
        const res = await regenerate('P1', persona);
        expect(res.status).toBe(403);
        expect(prisma.data.projects.find((p: any) => p.id === 'P1').githubWebhookSecret).toBe(
          before,
        );
        expect(prisma.project.update).not.toHaveBeenCalled();
      },
    );

    it('refuse (403) en session d’impersonation, secret inchangé (r40-m1)', async () => {
      const before = prisma.data.projects.find((p: any) => p.id === 'P2').githubWebhookSecret;
      const res = await fetch(`${baseUrl}/projects/P2/webhooks/github/secret`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${impersonationToken}` },
      });
      expect(res.status).toBe(403);
      expect(prisma.data.projects.find((p: any) => p.id === 'P2').githubWebhookSecret).toBe(before);
      expect(prisma.project.update).not.toHaveBeenCalled();
      // Même jeton hors impersonation : la route reste utilisable (le blocage vient bien du décorateur)
      expect((await regenerate('P2', 'owner')).status).toBe(201);
    });

    it('exige une session (401 sans jeton)', async () => {
      expect((await regenerate('P2')).status).toBe(401);
    });

    it('refuse (400) si aucun dépôt n’est lié', async () => {
      prisma.data.projects.find((p: any) => p.id === 'P2').githubRepo = null;
      expect((await regenerate('P2', 'owner')).status).toBe(400);
    });

    it('journalise l’action sans jamais écrire le secret', async () => {
      const { webhookSecret } = JSON.parse((await regenerate('P2', 'admin')).text);
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe('PROJECT_WEBHOOK_SECRET_REGENERATE');
      expect(JSON.stringify(audit)).not.toContain(webhookSecret);
      expect(JSON.stringify(audit)).not.toContain(prisma.data.projects[1].githubWebhookSecret);
    });
  });
});
