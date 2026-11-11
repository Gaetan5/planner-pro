import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PolicyService } from '../../src/authz/policy.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { SessionService } from '../../src/auth/session.service';
import { TokenService } from '../../src/auth/token.service';
import { NotesController } from '../../src/notes/notes.controller';
import { NotesService } from '../../src/notes/notes.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AiController } from '../../src/projects/ai.controller';
import { AiService } from '../../src/projects/ai.service';
import { CalendarSyncService } from '../../src/projects/calendar-sync.service';
import { CopilotService } from '../../src/projects/copilot.service';
import { IntegrationService } from '../../src/projects/integration.service';
import { ProactiveSchedulerService } from '../../src/projects/proactive-scheduler.service';
import { ProjectPermissionsService } from '../../src/projects/project-permissions.service';
import { ProjectsController } from '../../src/projects/projects.controller';
import { ProjectsService } from '../../src/projects/projects.service';
import { SprintService } from '../../src/projects/sprint.service';
import { RealtimeService } from '../../src/realtime/realtime.service';
import { TrackingGateway } from '../../src/tracking/tracking.gateway';
import { STUB_SID, sessionServiceStub } from '../support/session.test-support';
import { startHttpTestApp } from './http-test-app';

jest.setTimeout(30_000);

const UUID = '00000000-0000-4000-8000-0000000000aa';
const UUID2 = '00000000-0000-4000-8000-0000000000bb';

/** S23 : corps, paramètres d'URL et de requête validés avant d'atteindre les services (400). */
describe('S23 : validation des entrées HTTP', () => {
  const JWT_SECRET = 'test-secret-s23-input-0123456789abcdef0123';
  const savedEnv = { ...process.env };
  let app: INestApplication;
  let baseUrl: string;
  let token: string;

  const projectsService = {
    getProject: jest.fn().mockResolvedValue({ id: UUID }),
    updateDeliverableStatus: jest.fn().mockResolvedValue({ ok: true }),
    getTimeBlocks: jest.fn().mockResolvedValue([]),
    getResourceCapacityReport: jest.fn().mockResolvedValue([]),
  };
  const permissions = {
    getAuditLogs: jest.fn().mockResolvedValue([]),
    getProjectAuditLogs: jest.fn().mockResolvedValue([]),
    assertWorkspaceAccess: jest.fn().mockResolvedValue(undefined),
  };
  const calendarSync = { handleOAuthCallback: jest.fn().mockResolvedValue({ ok: true }) };
  const notesService = {
    createNote: jest.fn().mockResolvedValue({ id: UUID }),
    updateNote: jest.fn().mockResolvedValue({ id: UUID }),
    getNote: jest.fn().mockResolvedValue({ id: UUID }),
  };
  const aiService = {
    transcribeAndAnalyzeVoice: jest.fn().mockResolvedValue({ actions: [] }),
    analyzeCommand: jest.fn().mockResolvedValue({ actions: [] }),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const jwtService = new JwtService({ secret: JWT_SECRET });
    ({ app, baseUrl } = await startHttpTestApp({
      controllers: [ProjectsController, NotesController, AiController],
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        { provide: SprintService, useValue: {} },
        { provide: TrackingGateway, useValue: {} },
        { provide: RealtimeService, useValue: { isReady: false } },
        { provide: IntegrationService, useValue: {} },
        { provide: CalendarSyncService, useValue: calendarSync },
        { provide: PrismaService, useValue: {} },
        { provide: ProactiveSchedulerService, useValue: {} },
        { provide: ProjectPermissionsService, useValue: permissions },
        { provide: PolicyService, useValue: {} },
        { provide: NotesService, useValue: notesService },
        { provide: AiService, useValue: aiService },
        { provide: CopilotService, useValue: {} },
        { provide: JwtService, useValue: jwtService },
        TokenService,
        {
          provide: SessionService,
          useFactory: (tokens: TokenService) => sessionServiceStub(tokens),
          inject: [TokenService],
        },
        JwtAuthGuard,
      ],
    }));
    token = new TokenService(jwtService).signAccessToken({
      sub: 'user-1',
      email: 'u@x.com',
      sid: STUB_SID,
    });
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  beforeEach(() => jest.clearAllMocks());

  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  describe('identifiants d’URL (UUID)', () => {
    it.each(['abc', '1', '../../etc/passwd', 'null', '0000', `${UUID}x`])(
      'GET /projects/%s : 400, le service n’est pas appelé',
      async (bad) => {
        const res = await call('GET', `/projects/${encodeURIComponent(bad)}`);
        expect(res.status).toBe(400);
        expect(projectsService.getProject).not.toHaveBeenCalled();
      },
    );

    it('un UUID valide atteint le service', async () => {
      expect((await call('GET', `/projects/${UUID}`)).status).toBe(200);
      expect(projectsService.getProject).toHaveBeenCalledWith(UUID, 'user-1');
    });

    it('sprint : « backlog » reste accepté, tout autre texte non UUID est refusé', async () => {
      expect((await call('POST', '/projects/sprints/abc/tasks', { taskIds: [] })).status).toBe(400);
      expect(
        (await call('POST', '/projects/sprints/backlog/tasks', { taskIds: [] })).status,
      ).not.toBe(400);
    });

    it('notes : PUT/GET sur un identifiant mal formé : 400', async () => {
      expect((await call('GET', '/notes/pas-un-uuid')).status).toBe(400);
      expect((await call('PUT', '/notes/pas-un-uuid', { title: 't', content: 'c' })).status).toBe(
        400,
      );
      expect(notesService.getNote).not.toHaveBeenCalled();
    });
  });

  describe(':status d’un livrable (énumération)', () => {
    it.each(['NOPE', 'ready_for_review', '', "'; DROP TABLE x;--"])(
      'statut %j : 400',
      async (status) => {
        const res = await call(
          'PUT',
          `/projects/deliverables/${UUID}/status/${encodeURIComponent(status)}`,
        );
        expect([400, 404]).toContain(res.status);
        expect(projectsService.updateDeliverableStatus).not.toHaveBeenCalled();
      },
    );

    it('statut valide : transmis au service', async () => {
      const res = await call('PUT', `/projects/deliverables/${UUID}/status/READY_FOR_REVIEW`);
      expect(res.status).toBe(200);
      expect(projectsService.updateDeliverableStatus).toHaveBeenCalledWith(
        UUID,
        'user-1',
        'READY_FOR_REVIEW',
      );
    });
  });

  describe('?limit= des journaux d’audit', () => {
    it.each(['abc', '0', '-5', '501', '1.5', '1e3', '99999999999'])(
      'limit=%s : 400',
      async (limit) => {
        const res = await call('GET', `/projects/${UUID}/audit/logs?limit=${limit}`);
        expect(res.status).toBe(400);
        expect(permissions.getProjectAuditLogs).not.toHaveBeenCalled();
      },
    );

    it('limit=50 : transmis en nombre ; absent : valeur par défaut du service', async () => {
      expect((await call('GET', `/projects/${UUID}/audit/logs?limit=50`)).status).toBe(200);
      expect(permissions.getProjectAuditLogs).toHaveBeenLastCalledWith(UUID, 'user-1', 50);
      expect((await call('GET', `/projects/workspaces/${UUID}/audit/logs`)).status).toBe(200);
      expect(permissions.getAuditLogs).toHaveBeenLastCalledWith('user-1', UUID, undefined);
    });

    it('paramètre inconnu : 400 (liste blanche)', async () => {
      expect((await call('GET', `/projects/${UUID}/audit/logs?limit=5&sort=x`)).status).toBe(400);
    });
  });

  describe('fenêtre de dates des créneaux', () => {
    it.each([
      ['start=garbage'],
      ['end=2026-13-45'],
      ['start=2026-06-01T00:00:00Z&end=2026-05-01T00:00:00Z'], // fin avant début
      ['start=2020-01-01T00:00:00Z&end=2026-01-01T00:00:00Z'], // plus d'un an
    ])('%s : 400', async (query) => {
      const res = await call('GET', `/projects/timeblocks/all?${query}`);
      expect(res.status).toBe(400);
      expect(projectsService.getTimeBlocks).not.toHaveBeenCalled();
    });

    it('fenêtre valide ou absente : acceptée', async () => {
      expect(
        (await call('GET', '/projects/timeblocks/all?start=2026-06-01&end=2026-06-30')).status,
      ).toBe(200);
      expect((await call('GET', '/projects/timeblocks/all')).status).toBe(200);
    });
  });

  describe('?workspaceId= (UUID facultatif ou requis)', () => {
    it('capacité : mal formé 400, absent ou valide 200', async () => {
      expect((await call('GET', '/projects/resources/capacity?workspaceId=abc')).status).toBe(400);
      expect((await call('GET', '/projects/resources/capacity')).status).toBe(200);
      expect((await call('GET', `/projects/resources/capacity?workspaceId=${UUID}`)).status).toBe(
        200,
      );
    });

    it('copilote : workspaceId obligatoire et UUID', async () => {
      expect((await call('GET', '/projects/ai/copilot/alerts')).status).toBe(400);
      expect((await call('GET', '/projects/ai/copilot/alerts?workspaceId=x')).status).toBe(400);
    });
  });

  describe('notes (DTO classe)', () => {
    it.each([
      ['titre trop long', { title: 'x'.repeat(192), content: 'c' }],
      ['contenu trop long', { title: 't', content: 'x'.repeat(16_001) }],
      ['contenu absent', { title: 't' }],
      ['titre non texte', { title: 12, content: 'c' }],
      ['champ inattendu', { title: 't', content: 'c', userId: 'autre' }],
      ['corps vide', {}],
    ])('POST /notes, %s : 400, le service n’est pas appelé', async (_label, body) => {
      const res = await call('POST', '/notes', body);
      expect(res.status).toBe(400);
      expect(notesService.createNote).not.toHaveBeenCalled();
    });

    it('note valide aux bornes : acceptée', async () => {
      const res = await call('POST', '/notes', {
        title: 'x'.repeat(191),
        content: 'y'.repeat(16_000),
      });
      expect(res.status).toBe(201);
      expect(notesService.createNote).toHaveBeenCalledTimes(1);
    });

    it('PUT /notes/:id valide le corps comme la création', async () => {
      expect((await call('PUT', `/notes/${UUID}`, { title: 't' })).status).toBe(400);
      expect((await call('PUT', `/notes/${UUID}`, { title: 't', content: 'c' })).status).toBe(200);
    });
  });

  describe('retour OAuth du calendrier (DTO classe)', () => {
    const url = `/projects/workspaces/${UUID}/calendar/oauth/callback`;
    it.each([
      ['fournisseur inconnu', { provider: 'DROPBOX', code: 'abc' }],
      ['code absent', { provider: 'OUTLOOK' }],
      ['code trop long', { provider: 'OUTLOOK', code: 'x'.repeat(4097) }],
      ['code non texte', { provider: 'OUTLOOK', code: { $ne: null } }],
      ['champ inattendu', { provider: 'OUTLOOK', code: 'abc', redirect: 'http://evil' }],
    ])('%s : 400, aucun échange de code', async (_label, body) => {
      expect((await call('POST', url, body)).status).toBe(400);
      expect(calendarSync.handleOAuthCallback).not.toHaveBeenCalled();
    });

    it('corps valide : transmis', async () => {
      expect((await call('POST', url, { provider: 'GOOGLE_CALENDAR', code: 'abc' })).status).toBe(
        201,
      );
      expect(calendarSync.handleOAuthCallback).toHaveBeenCalledWith(UUID, 'GOOGLE_CALENDAR', 'abc');
    });
  });

  describe('envois multipart de l’IA (DTO classe)', () => {
    const voice = (fields: Record<string, string>) => {
      const form = new FormData();
      form.append('file', new Blob(['x'], { type: 'audio/webm' }), 'a.webm');
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      return fetch(`${baseUrl}/projects/ai/voice`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    };

    it.each([
      ['workspaceId absent', {}],
      ['workspaceId non UUID', { workspaceId: 'abc' }],
      ['projectId non UUID', { workspaceId: UUID, projectId: "1' OR '1'='1" }],
      ['isMock hors valeurs admises', { workspaceId: UUID, isMock: 'peut-être' }],
      ['champ inattendu', { workspaceId: UUID, role: 'ADMIN' }],
    ])('voice, %s : 400, aucun traitement', async (_label, fields) => {
      expect((await voice(fields)).status).toBe(400);
      expect(aiService.transcribeAndAnalyzeVoice).not.toHaveBeenCalled();
    });

    it('champs valides : transmis au service', async () => {
      const res = await voice({ workspaceId: UUID, projectId: UUID2 });
      expect(res.status).toBe(200);
      expect(aiService.transcribeAndAnalyzeVoice).toHaveBeenCalledWith(
        'user-1',
        UUID,
        UUID2,
        expect.anything(),
        'audio/webm',
        false,
      );
    });

    it('commande IA trop longue : 400 (coût d’appel au modèle borné)', async () => {
      const res = await call('POST', '/projects/ai/command', {
        command: 'x'.repeat(4001),
        workspaceId: UUID,
      });
      expect(res.status).toBe(400);
      expect(aiService.analyzeCommand).not.toHaveBeenCalled();
    });
  });
});
