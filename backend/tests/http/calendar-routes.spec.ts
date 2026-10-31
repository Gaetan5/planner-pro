import { INestApplication, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ProjectsController } from '../../src/projects/projects.controller';
import { ProjectsService } from '../../src/projects/projects.service';
import { SprintService } from '../../src/projects/sprint.service';
import { TrackingGateway } from '../../src/tracking/tracking.gateway';
import { IntegrationService } from '../../src/projects/integration.service';
import { CalendarSyncService } from '../../src/projects/calendar-sync.service';
import { ProjectPermissionsService } from '../../src/projects/project-permissions.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProactiveSchedulerService } from '../../src/projects/proactive-scheduler.service';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { TokenService } from '../../src/auth/token.service';
import { SessionService } from '../../src/auth/session.service';
import { STUB_SID, sessionServiceStub } from '../support/session.test-support';
import { startHttpTestApp } from './http-test-app';

/**
 * S5 : plus de calendrier simulé public ; synchronisation et export réservés à OWNER/ADMIN.
 */
describe('S5 : routes calendrier (HTTP)', () => {
  const JWT_SECRET = 'test-secret-s5-routes-0123456789abcdef';
  let app: INestApplication;
  let baseUrl: string;
  let token: string;
  let role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  const savedEnv = { ...process.env };

  const projectsService = { getProject: jest.fn() };
  const calendarSync = {
    syncCalendarEvents: jest.fn().mockResolvedValue({ importedCount: 0, skipped: [] }),
    exportToCalendar: jest.fn().mockResolvedValue({ success: true, exportedCount: 0 }),
  };
  // Prisma simulé : la membership n'est trouvée que si le rôle courant est autorisé
  const prisma = {
    membership: {
      findFirst: jest.fn(async ({ where }) =>
        where.role.in.includes(role) ? { workspaceId: where.workspaceId, role } : null,
      ),
    },
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const jwtService = new JwtService({ secret: JWT_SECRET });
    ({ app, baseUrl } = await startHttpTestApp({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        { provide: SprintService, useValue: {} },
        { provide: TrackingGateway, useValue: {} },
        { provide: IntegrationService, useValue: {} },
        { provide: CalendarSyncService, useValue: calendarSync },
        { provide: PrismaService, useValue: prisma },
        { provide: ProactiveSchedulerService, useValue: {} },
        { provide: JwtService, useValue: jwtService },
        ProjectPermissionsService,
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

  const post = (path: string) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

  it('GET /projects/mock-calendar n’est plus public : 401 sans jeton, aucun calendrier renvoyé', async () => {
    const res = await fetch(`${baseUrl}/projects/mock-calendar?email=%3Cscript%3E`);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('VCALENDAR');
  });

  it('GET /projects/mock-calendar authentifié : traité comme un identifiant de projet (404)', async () => {
    projectsService.getProject.mockRejectedValue(new NotFoundException('Projet introuvable'));
    const res = await fetch(`${baseUrl}/projects/mock-calendar?format=json`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    expect(projectsService.getProject).toHaveBeenCalledWith('mock-calendar', 'user-1');
  });

  it.each(['VIEWER', 'MEMBER'] as const)(
    '%s sur POST .../calendar/sync : 403 et aucune synchronisation',
    async (r) => {
      role = r;
      const res = await post('/projects/workspaces/ws-1/calendar/sync');
      expect(res.status).toBe(403);
      expect(calendarSync.syncCalendarEvents).not.toHaveBeenCalled();
    },
  );

  it.each(['VIEWER', 'MEMBER'] as const)(
    '%s sur POST .../integrations/:id/export : 403 et aucun export',
    async (r) => {
      role = r;
      const res = await post('/projects/workspaces/ws-1/integrations/int-1/export');
      expect(res.status).toBe(403);
      expect(calendarSync.exportToCalendar).not.toHaveBeenCalled();
    },
  );

  it('ADMIN sur sync : autorisé, et l’appelant est transmis au service', async () => {
    role = 'ADMIN';
    const res = await post('/projects/workspaces/ws-1/calendar/sync');
    expect(res.status).toBe(201);
    expect(calendarSync.syncCalendarEvents).toHaveBeenCalledWith('ws-1', 'user-1');
  });

  it('OWNER sur export : autorisé', async () => {
    role = 'OWNER';
    const res = await post('/projects/workspaces/ws-1/integrations/int-1/export');
    expect(res.status).toBe(201);
    expect(calendarSync.exportToCalendar).toHaveBeenCalledWith('ws-1', 'int-1');
  });
});
