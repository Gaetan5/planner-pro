import { E2eSession, E2eUser, E2eWorld } from '../support/e2e-world';

/**
 * P7 / autorisation : IDOR et BOLA entre espaces de travail, matrice RBAC sur les routes
 * sensibles (docs/security/matrice-rbac.md, écrite ici indépendamment de `permissions.ts`),
 * impersonation. Application complète et vraie base : les profils se connectent par `POST /auth/login`.
 * Un refus est un 403 (ou un 404 pour une ressource d'un autre espace), jamais un 5xx ni une écriture.
 */
describe('P7 e2e : autorisation', () => {
  let world: E2eWorld;
  beforeAll(async () => {
    world = await E2eWorld.start();
  });
  afterAll(async () => {
    delete process.env.FEATURE_IMPERSONATION_ENABLED;
    await world?.close();
  });

  const SECRET_MARK = 'CONFIDENTIEL-E2E';

  describe('IDOR / BOLA entre espaces de travail', () => {
    const ctx = {} as {
      attacker: E2eSession;
      victim: E2eUser;
      wsB: string;
      pB: string;
      tB: string;
      nB: string;
      integrationB: string;
      attackerNote: string;
    };

    beforeAll(async () => {
      const ownerA = await world.createUser({ label: 'ownerA' });
      const ownerB = await world.createUser({ label: 'ownerB' });
      ctx.victim = ownerB;
      await world.createWorkspace(ownerA, 'Espace A');
      ctx.wsB = await world.createWorkspace(ownerB, `Espace B ${SECRET_MARK}`);
      ctx.pB = await world.createProject(ctx.wsB, ownerB, `Projet B ${SECRET_MARK}`);
      ctx.tB = await world.createTask(ctx.pB, ownerB, `Tâche B ${SECRET_MARK}`);
      ctx.nB = await world.createNote(ownerB, `Note B ${SECRET_MARK}`);
      const integration = await world.prisma.integration.create({
        data: {
          workspaceId: ctx.wsB,
          type: 'GITHUB',
          name: `Intégration B ${SECRET_MARK}`,
        } as never,
      });
      ctx.integrationB = integration.id;
      await world.prisma.project.update({
        where: { id: ctx.pB },
        data: { githubRepo: 'victime/depot-prive' },
      });
      ctx.attacker = await world.login(ownerA);
    });

    const attack = (method: string, path: string, body?: unknown) =>
      world.request(method, path, { accessToken: ctx.attacker.accessToken, body });

    const expectDenied = (path: string, res: { status: number; text: string }) => {
      expect([path, [403, 404].includes(res.status)]).toEqual([path, true]);
      expect(res.text).not.toContain(SECRET_MARK);
    };

    it('lecture : aucun projet, tâche, membre, journal, intégration ni dépôt de l’espace B', async () => {
      const reads: Array<[string, string]> = [
        ['GET', `/projects/${ctx.pB}`],
        ['GET', `/projects/${ctx.pB}/tasks`],
        ['GET', `/projects/${ctx.pB}/members`],
        ['GET', `/projects/${ctx.pB}/audit/logs`],
        ['GET', `/projects/${ctx.pB}/critical-path`],
        ['GET', `/projects/${ctx.pB}/delivery-report`],
        ['GET', `/projects/workspaces/${ctx.wsB}/members`],
        ['GET', `/projects/workspaces/${ctx.wsB}/audit/logs`],
        ['GET', `/projects/workspaces/${ctx.wsB}/integrations`],
        ['GET', `/projects/workspaces/${ctx.wsB}/integrations/status`],
        ['GET', `/projects/workspaces/${ctx.wsB}/finances`],
        ['GET', `/projects/workspaces/${ctx.wsB}/sprints`],
        ['GET', `/projects/workspaces/${ctx.wsB}/velocity`],
      ];
      for (const [method, path] of reads) {
        const res = await attack(method, path);
        expectDenied(path, res);
      }
    });

    it('notes : une note d’autrui est introuvable (corps vide ou refus), jamais renvoyée', async () => {
      // Les notes sont personnelles : la requête est filtrée par propriétaire, donc `null` (200 sans corps)
      const read = await attack('GET', `/notes/${ctx.nB}`);
      expect([200, 403, 404]).toContain(read.status);
      expect(read.text).not.toContain(SECRET_MARK);
      const del = await attack('DELETE', `/notes/${ctx.nB}`);
      expect(del.status).toBeLessThan(500);
      expect(del.text).not.toContain(SECRET_MARK);
    });

    it('les listes de l’attaquant ne contiennent aucune ressource de l’espace B', async () => {
      for (const path of ['/projects', '/projects/workspaces', '/projects/members', '/notes']) {
        const res = await attack('GET', path);
        expect(res.status).toBe(200);
        expect(res.text).not.toContain(SECRET_MARK);
        expect(res.text).not.toContain(ctx.pB);
        expect(res.text).not.toContain(ctx.wsB);
      }
    });

    it('écriture : modifier, supprimer ou créer dans l’espace B est refusé et ne change rien', async () => {
      const writes: Array<[string, string, unknown?]> = [
        ['PUT', `/projects/${ctx.pB}`, { name: 'piraté' }],
        ['DELETE', `/projects/${ctx.pB}`],
        ['POST', `/projects/${ctx.pB}/tasks`, { title: 'piratée' }],
        ['PUT', `/projects/tasks/${ctx.tB}`, { title: 'piratée' }],
        ['DELETE', `/projects/tasks/${ctx.tB}`],
        ['POST', `/projects/${ctx.pB}/members`, { targetUserId: ctx.victim.id, role: 'CLIENT' }],
        ['DELETE', `/projects/${ctx.pB}/members/${ctx.victim.id}`],
        ['POST', `/projects`, { name: 'intrus', workspaceId: ctx.wsB }],
        ['POST', `/projects/workspaces/${ctx.wsB}/integrations`, { type: 'GITHUB', name: 'x' }],
        ['DELETE', `/projects/integrations/${ctx.integrationB}`],
        ['POST', `/projects/integrations/${ctx.integrationB}/toggle`],
        ['POST', `/projects/${ctx.pB}/webhooks/github/secret`],
        ['PUT', `/notes/${ctx.nB}`, { title: 'piratée', content: 'x' }],
      ];
      for (const [method, path, body] of writes) {
        const res = await attack(method, path, body);
        expect([method, path, [400, 403, 404].includes(res.status)]).toEqual([method, path, true]);
        expect(res.text).not.toContain(SECRET_MARK);
      }
      const project = await world.prisma.project.findUnique({ where: { id: ctx.pB } });
      expect(project?.name).toContain(SECRET_MARK);
      expect(project?.deletedAt).toBeNull();
      const task = await world.prisma.task.findUnique({ where: { id: ctx.tB } });
      expect(task?.title).toContain(SECRET_MARK);
      expect(task?.deletedAt).toBeNull();
      const note = await world.prisma.note.findUnique({ where: { id: ctx.nB } });
      expect(note?.title).toContain(SECRET_MARK);
      expect(note?.deletedAt).toBeNull();
      expect(await world.prisma.integration.count({ where: { id: ctx.integrationB } })).toBe(1);
      expect(
        await world.prisma.project.count({ where: { workspaceId: ctx.wsB, name: 'intrus' } }),
      ).toBe(0);
    });

    it('le secret de webhook n’est jamais renvoyé, même au propriétaire du projet', async () => {
      const owner = await world.login(ctx.victim);
      const generated = await world.request('POST', `/projects/${ctx.pB}/webhooks/github/secret`, {
        accessToken: owner.accessToken,
      });
      expect(generated.status).toBe(201);
      expect(generated.body.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
      for (const path of ['/projects', `/projects/${ctx.pB}`]) {
        const read = await world.request('GET', path, { accessToken: owner.accessToken });
        expect(read.status).toBe(200);
        expect(read.text).not.toContain(generated.body.webhookSecret);
        expect(read.text).not.toMatch(/githubWebhookSecret/);
      }
    });
  });

  describe('matrice RBAC : routes sensibles', () => {
    type Who =
      'owner' | 'admin' | 'member' | 'viewer' | 'client' | 'commenter' | 'contributor' | 'manager';
    const ALL: Who[] = [
      'owner',
      'admin',
      'member',
      'viewer',
      'client',
      'commenter',
      'contributor',
      'manager',
    ];
    const sessions = {} as Record<Who, E2eSession>;
    const ids = {} as { ws: string; project: string; spare: E2eUser };

    beforeAll(async () => {
      const users = {} as Record<Who, E2eUser>;
      for (const who of ALL) users[who] = await world.createUser({ label: who });
      ids.spare = await world.createUser({ label: 'spare' });
      ids.ws = await world.createWorkspace(users.owner, 'Espace RBAC');
      await world.addMember(ids.ws, users.admin, 'ADMIN');
      for (const who of ['member', 'commenter', 'contributor', 'manager'] as Who[]) {
        await world.addMember(ids.ws, users[who], 'MEMBER');
      }
      // Invité « projet » : VIEWER du workspace plus rôle de projet (matrice § 4)
      await world.addMember(ids.ws, users.viewer, 'VIEWER');
      await world.addMember(ids.ws, users.client, 'VIEWER');
      await world.addMember(ids.ws, ids.spare, 'VIEWER');
      ids.project = await world.createProject(ids.ws, users.owner, 'Projet RBAC');
      await world.addProjectMember(ids.project, users.client, 'CLIENT');
      await world.addProjectMember(ids.project, users.commenter, 'COMMENTER');
      await world.addProjectMember(ids.project, users.contributor, 'CONTRIBUTOR');
      await world.addProjectMember(ids.project, users.manager, 'MANAGER');
      for (const who of ALL) sessions[who] = await world.login(users[who]);
    });

    interface Rule {
      label: string;
      method: string;
      path: () => string;
      body?: () => unknown;
      allowed: Who[];
    }
    const rules: Rule[] = [
      {
        label: 'project.read : GET /projects/:id',
        method: 'GET',
        path: () => `/projects/${ids.project}`,
        allowed: ['owner', 'admin', 'client', 'commenter', 'contributor', 'manager'],
      },
      {
        label: 'task.read : GET /projects/:id/tasks',
        method: 'GET',
        path: () => `/projects/${ids.project}/tasks`,
        allowed: ['owner', 'admin', 'client', 'commenter', 'contributor', 'manager'],
      },
      {
        label: 'task.write : POST /projects/:id/tasks',
        method: 'POST',
        path: () => `/projects/${ids.project}/tasks`,
        body: () => ({ title: 'Tâche RBAC' }),
        allowed: ['owner', 'admin', 'contributor', 'manager'],
      },
      {
        label: 'project.write : PUT /projects/:id',
        method: 'PUT',
        path: () => `/projects/${ids.project}`,
        body: () => ({ description: 'mise à jour RBAC' }),
        allowed: ['owner', 'admin', 'contributor', 'manager'],
      },
      {
        label: 'project.manage : POST /projects/:id/members',
        method: 'POST',
        path: () => `/projects/${ids.project}/members`,
        body: () => ({ targetUserId: ids.spare.id, role: 'CLIENT' }),
        allowed: ['owner', 'admin', 'manager'],
      },
      {
        label: 'project.manage : régénérer le secret de webhook (dépôt lié)',
        method: 'POST',
        path: () => `/projects/${ids.project}/webhooks/github/secret`,
        allowed: ['owner', 'admin', 'manager'],
      },
      {
        label: 'workspace.audit.read : GET /projects/workspaces/:id/audit/logs',
        method: 'GET',
        path: () => `/projects/workspaces/${ids.ws}/audit/logs`,
        allowed: ['owner', 'admin'],
      },
      {
        label: 'workspace.finances.read : GET /projects/workspaces/:id/finances',
        method: 'GET',
        path: () => `/projects/workspaces/${ids.ws}/finances`,
        allowed: ['owner', 'admin'],
      },
      {
        label: 'workspace.directory.read : GET /projects/workspaces/:id/integrations',
        method: 'GET',
        path: () => `/projects/workspaces/${ids.ws}/integrations`,
        allowed: ['owner', 'admin', 'member', 'commenter', 'contributor', 'manager'],
      },
      {
        label: 'sprint.read : GET /projects/workspaces/:id/sprints',
        method: 'GET',
        path: () => `/projects/workspaces/${ids.ws}/sprints`,
        allowed: ['owner', 'admin', 'member', 'commenter', 'contributor', 'manager'],
      },
      {
        label: 'project.create : POST /projects',
        method: 'POST',
        path: () => '/projects',
        body: () => ({ name: 'Projet créé RBAC', workspaceId: ids.ws }),
        allowed: ['owner', 'admin', 'member', 'commenter', 'contributor', 'manager'],
      },
    ];

    beforeAll(async () => {
      // Dépôt lié : condition de la régénération du secret
      await world.prisma.project.update({
        where: { id: ids.project },
        data: { githubRepo: 'org/depot-rbac' },
      });
    });

    const cases = rules.flatMap((rule) =>
      ALL.map((who) => [rule.label, who, rule.allowed.includes(who), rule] as const),
    );

    it.each(cases)('%s : %s -> %s', async (_label, who, allowed, rule) => {
      const res = await world.request(rule.method, rule.path(), {
        accessToken: sessions[who].accessToken,
        body: rule.body?.(),
      });
      if (allowed) {
        expect(res.status).toBeLessThan(300);
      } else {
        expect(res.status).toBe(403);
      }
    });

    it('DELETE /projects/:id (project.manage) : refusé sous MANAGER, accepté pour MANAGER', async () => {
      const refused = ['member', 'viewer', 'client', 'commenter', 'contributor'] as Who[];
      const disposable = await world.prisma.project.create({
        data: {
          name: 'À supprimer',
          workspaceId: ids.ws,
          userId: (
            await world.prisma.membership.findFirstOrThrow({
              where: { workspaceId: ids.ws, role: 'OWNER' },
            })
          ).userId,
        },
      });
      await world.prisma.projectMembership.create({
        data: {
          projectId: disposable.id,
          userId: (
            await world.prisma.membership.findFirstOrThrow({
              where: { workspaceId: ids.ws, role: 'VIEWER' },
            })
          ).userId,
          role: 'COMMENTER',
        },
      });
      for (const who of refused) {
        const res = await world.request('DELETE', `/projects/${disposable.id}`, {
          accessToken: sessions[who].accessToken,
        });
        expect(res.status).toBe(403);
      }
      expect(
        (await world.prisma.project.findUnique({ where: { id: disposable.id } }))?.deletedAt,
      ).toBeNull();
      const ok = await world.request('DELETE', `/projects/${disposable.id}`, {
        accessToken: sessions.admin.accessToken,
      });
      expect(ok.status).toBeLessThan(300);
    });

    it('escalade : un CONTRIBUTOR ne s’attribue pas le rôle MANAGER, un MEMBER sans projet non plus', async () => {
      const contributorId = (
        await world.prisma.user.findFirstOrThrow({
          where: { email: { startsWith: 'contributor-' } },
        })
      ).id;
      const self = await world.request('POST', `/projects/${ids.project}/members`, {
        accessToken: sessions.contributor.accessToken,
        body: { targetUserId: contributorId, role: 'MANAGER' },
      });
      expect(self.status).toBe(403);
      expect(
        (
          await world.prisma.projectMembership.findFirstOrThrow({
            where: { projectId: ids.project, userId: contributorId },
          })
        ).role,
      ).toBe('CONTRIBUTOR');
      // Un MANAGER non plus n'attribue MANAGER (OWNER et ADMIN seulement)
      const byManager = await world.request('POST', `/projects/${ids.project}/members`, {
        accessToken: sessions.manager.accessToken,
        body: { targetUserId: ids.spare.id, role: 'MANAGER' },
      });
      expect(byManager.status).toBe(403);
    });
  });

  describe('impersonation (S18)', () => {
    let superAdmin: E2eUser;
    let platformAdmin: E2eUser;
    let target: E2eUser;
    let plainUser: E2eUser;
    let targetProject: string;

    beforeAll(async () => {
      superAdmin = await world.createUser({ label: 'super', platformRole: 'SUPER_ADMIN' });
      platformAdmin = await world.createUser({ label: 'padmin', platformRole: 'PLATFORM_ADMIN' });
      target = await world.createUser({ label: 'cible' });
      plainUser = await world.createUser({ label: 'simple' });
      const targetWorkspace = await world.createWorkspace(target, 'Espace de la cible');
      targetProject = await world.createProject(targetWorkspace, target, 'Projet de la cible');
      await world.addMember(targetWorkspace, plainUser, 'VIEWER');
      // Dépôt lié : sans lui, la régénération du secret répondrait 400 pour une autre raison
      await world.prisma.project.update({
        where: { id: targetProject },
        data: { githubRepo: 'org/depot-cible' },
      });
    });
    afterEach(() => {
      delete process.env.FEATURE_IMPERSONATION_ENABLED;
    });

    const impersonate = (
      session: E2eSession,
      userId: string,
      body: unknown = { reason: 'Support e2e' },
    ) =>
      world.request('POST', `/admin/users/${userId}/impersonate`, {
        accessToken: session.accessToken,
        body,
      });

    it('désactivée par défaut : 404, même pour un SUPER_ADMIN', async () => {
      const session = await world.login(superAdmin);
      expect((await impersonate(session, target.id)).status).toBe(404);
    });

    it('refus : simple utilisateur, PLATFORM_ADMIN, motif absent, cible de plateforme, cible inconnue', async () => {
      process.env.FEATURE_IMPERSONATION_ENABLED = 'true';
      expect((await impersonate(await world.login(plainUser), target.id)).status).toBe(403);
      expect((await impersonate(await world.login(platformAdmin), target.id)).status).toBe(403);
      const session = await world.login(superAdmin);
      expect((await impersonate(session, target.id, {})).status).toBe(400);
      expect((await impersonate(session, platformAdmin.id)).status).toBe(403);
      expect((await impersonate(session, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect(
        await world.prisma.platformAuditLog.count({
          where: { actorId: superAdmin.id, action: 'USER_IMPERSONATED' },
        }),
      ).toBe(0);
    });

    it('session d’impersonation : routes prévues seulement, aucun refresh, jeton absent du corps, audit', async () => {
      process.env.FEATURE_IMPERSONATION_ENABLED = 'true';
      const admin = await world.login(superAdmin);
      const res = await impersonate(admin, target.id);
      expect(res.status).toBe(201);
      const cookie = res.setCookies.find((c) => c.startsWith('accessToken='))!;
      const token = cookie.split(';')[0].slice('accessToken='.length);
      expect(res.text).not.toContain(token);
      // Pas de jeton de rafraîchissement : la session est limitée dans le temps
      const refreshCookie = res.setCookies.find((c) => c.startsWith('refreshToken='));
      expect(refreshCookie === undefined || /Expires=Thu, 01 Jan 1970/i.test(refreshCookie)).toBe(
        true,
      );

      // La session de l'administrateur ne survit pas
      expect(
        (await world.request('GET', '/admin/overview', { accessToken: admin.accessToken })).status,
      ).toBe(401);

      // Lecture en tant que cible : prévue
      const read = await world.request('GET', '/projects/workspaces', { accessToken: token });
      expect(read.status).toBe(200);

      // Routes qui donneraient un accès persistant ou administreraient : interdites (403)
      const forbidden: Array<[string, string, unknown?]> = [
        ['POST', '/auth/mfa/setup', {}],
        ['POST', '/auth/mfa/disable', { code: '000000' }],
        ['GET', '/auth/mfa/status'],
        ['POST', '/auth/github/unlink'],
        ['POST', '/auth/sessions/revoke-others'],
        // Routes où seule l'interdiction d'impersonation s'oppose à la cible (propriétaire du projet)
        ['POST', `/projects/${targetProject}/webhooks/github/secret`],
        [
          'POST',
          `/projects/${targetProject}/members`,
          { targetUserId: plainUser.id, role: 'CLIENT' },
        ],
        ['GET', '/admin/overview'],
        ['POST', `/admin/users/${plainUser.id}/impersonate`, { reason: 'enchaînement' }],
      ];
      for (const [method, path, body] of forbidden) {
        const out = await world.request(method, path, { accessToken: token, body });
        expect([method, path, out.status]).toEqual([method, path, 403]);
      }

      const audit = await world.prisma.platformAuditLog.findFirstOrThrow({
        where: { actorId: superAdmin.id, action: 'USER_IMPERSONATED', targetId: target.id },
      });
      expect((audit.metadata as { reason: string }).reason).toBe('Support e2e');
    });
  });
});
