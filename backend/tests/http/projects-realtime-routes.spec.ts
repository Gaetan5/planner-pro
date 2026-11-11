import { ForbiddenException, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PolicyService } from '../../src/authz/policy.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { SessionService } from '../../src/auth/session.service';
import { TokenService } from '../../src/auth/token.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CalendarSyncService } from '../../src/projects/calendar-sync.service';
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

const T1 = '2f1b3c4d-1111-4222-8333-444455556666';
const T2 = '2f1b3c4d-1111-4222-8333-444455557777';

/**
 * S13, S14, S12, A4 : contrat HTTP des routes du contrôleur de projets (intégrations,
 * association de tâches à un sprint, planification) et diffusion temps réel par RealtimeService.
 */
describe('Routes projets : intégrations, sprints, planification, diffusion', () => {
  const JWT_SECRET = 'test-secret-projects-realtime-0123456789abcdef';
  let app: INestApplication;
  let baseUrl: string;
  let token: string;
  const savedEnv = { ...process.env };

  const integrationService = {
    getWorkspaceIdOf: jest.fn(),
    toggleIntegration: jest
      .fn()
      .mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000b1', active: false }),
    deleteIntegration: jest.fn().mockResolvedValue({ success: true }),
  };
  const sprintService = { associateTasksToSprint: jest.fn() };
  const projectsService = { getTasksForBroadcast: jest.fn() };
  const realtime = { isReady: true, emitToProject: jest.fn(), emitSignalToWorkspace: jest.fn() };
  const scheduler = { autoScheduleWorkspace: jest.fn().mockResolvedValue({ success: true }) };
  const calendarSync = { detectCalendarConflicts: jest.fn().mockResolvedValue([]) };
  const policy = {
    assertWorkspace: jest.fn(),
    listAccessibleProjectIds: jest.fn().mockResolvedValue(['P1']),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const jwtService = new JwtService({ secret: JWT_SECRET });
    ({ app, baseUrl } = await startHttpTestApp({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        { provide: SprintService, useValue: sprintService },
        { provide: TrackingGateway, useValue: {} },
        { provide: RealtimeService, useValue: realtime },
        { provide: IntegrationService, useValue: integrationService },
        { provide: CalendarSyncService, useValue: calendarSync },
        { provide: PrismaService, useValue: {} },
        { provide: ProactiveSchedulerService, useValue: scheduler },
        { provide: ProjectPermissionsService, useValue: { assertWorkspaceAccess: jest.fn() } },
        { provide: PolicyService, useValue: policy },
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

  beforeEach(() => {
    jest.clearAllMocks();
    policy.assertWorkspace.mockResolvedValue({});
    policy.listAccessibleProjectIds.mockResolvedValue(['P1']);
  });

  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  describe.each([
    [
      'POST',
      '/projects/integrations/00000000-0000-4000-8000-0000000000b1/toggle',
      'toggleIntegration',
    ],
    ['DELETE', '/projects/integrations/00000000-0000-4000-8000-0000000000b1', 'deleteIntegration'],
  ] as const)('%s %s (S14)', (method, path, serviceMethod) => {
    it('intégration inexistante : 404 et aucun appel au service', async () => {
      integrationService.getWorkspaceIdOf.mockResolvedValue(null);
      expect((await call(method, path)).status).toBe(404);
      expect(integrationService[serviceMethod]).not.toHaveBeenCalled();
    });

    it('intégration d’un workspace dont l’appelant n’est pas membre : 404 (pas 403), aucun appel', async () => {
      integrationService.getWorkspaceIdOf.mockResolvedValue('ws-etranger');
      policy.assertWorkspace.mockRejectedValue(new ForbiddenException('Workspace not found'));
      expect((await call(method, path)).status).toBe(404);
      expect(integrationService[serviceMethod]).not.toHaveBeenCalled();
    });

    it('OWNER/ADMIN du workspace propriétaire : le service reçoit (workspaceId, id)', async () => {
      integrationService.getWorkspaceIdOf.mockResolvedValue('00000000-0000-4000-8000-0000000000a1');
      const res = await call(method, path);
      expect(res.status).toBeLessThan(300);
      expect(policy.assertWorkspace).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-0000000000a1',
        'user-1',
        'workspace.integrations.manage',
      );
      expect(integrationService[serviceMethod]).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-0000000000b1',
      );
    });
  });

  describe('POST /projects/sprints/:sprintId/tasks (S13)', () => {
    it('corps invalide (identifiant non UUID) : 400 et aucun appel au service', async () => {
      const res = await call('POST', '/projects/sprints/backlog/tasks', { taskIds: ['abc'] });
      expect(res.status).toBe(400);
      expect(sprintService.associateTasksToSprint).not.toHaveBeenCalled();
    });

    it('diffuse uniquement les tâches modifiées, vers les salons de leurs projets', async () => {
      sprintService.associateTasksToSprint.mockResolvedValue([
        { id: T1, projectId: 'P1', workspaceId: '00000000-0000-4000-8000-0000000000a1' },
      ]);
      projectsService.getTasksForBroadcast.mockResolvedValue([
        { id: T1, projectId: 'P1', title: 't' },
      ]);
      const res = await call('POST', '/projects/sprints/backlog/tasks', { taskIds: [T1, T2] });
      expect(res.status).toBe(201);
      expect(sprintService.associateTasksToSprint).toHaveBeenCalledWith(null, [T1, T2], 'user-1');
      expect(projectsService.getTasksForBroadcast).toHaveBeenCalledWith([T1]);
      expect(realtime.emitToProject).toHaveBeenCalledTimes(1);
      expect(realtime.emitToProject).toHaveBeenCalledWith(
        'P1',
        'task-status-changed',
        expect.objectContaining({ taskId: T1 }),
      );
    });

    it('refus du service (403) : aucune diffusion', async () => {
      sprintService.associateTasksToSprint.mockRejectedValue(new ForbiddenException('refusé'));
      const res = await call(
        'POST',
        '/projects/sprints/00000000-0000-4000-8000-0000000000e1/tasks',
        { taskIds: [T1] },
      );
      expect(res.status).toBe(403);
      expect(realtime.emitToProject).not.toHaveBeenCalled();
    });
  });

  describe('planification et conflits (S12)', () => {
    it('auto-schedule transmet l’appelant au service', async () => {
      const res = await call(
        'POST',
        '/projects/workspaces/00000000-0000-4000-8000-0000000000a1/auto-schedule',
      );
      expect(res.status).toBe(201);
      expect(scheduler.autoScheduleWorkspace).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-0000000000a1',
        'user-1',
      );
    });

    it('calendar-conflicts est borné aux projets accessibles', async () => {
      const res = await call(
        'GET',
        '/projects/workspaces/00000000-0000-4000-8000-0000000000a1/calendar-conflicts',
      );
      expect(res.status).toBe(200);
      expect(calendarSync.detectCalendarConflicts).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-0000000000a1',
        ['P1'],
      );
    });
  });
});
