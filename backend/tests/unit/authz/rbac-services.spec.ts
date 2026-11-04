/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PolicyService } from '../../../src/authz/policy.service';
import { NotificationsService } from '../../../src/notifications/notifications.service';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';
import { GeminiService } from '../../../src/notes/gemini.service';
import { NotesService } from '../../../src/notes/notes.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { CommentsService } from '../../../src/projects/comments.service';
import { CopilotService } from '../../../src/projects/copilot.service';
import { DependenciesService } from '../../../src/projects/dependencies.service';
import { FinancesService } from '../../../src/projects/finances.service';
import { IntegrationService } from '../../../src/projects/integration.service';
import { MilestonesService } from '../../../src/projects/milestones.service';
import { ProjectPermissionsService } from '../../../src/projects/project-permissions.service';
import { ProjectsService } from '../../../src/projects/projects.service';
import { ResourcesService } from '../../../src/projects/resources.service';
import { SprintService } from '../../../src/projects/sprint.service';
import { TasksService } from '../../../src/projects/tasks.service';
import { TimeBlocksService } from '../../../src/projects/timeblocks.service';
import { TrackingService } from '../../../src/tracking/tracking.service';
import { CalendarSyncService } from '../../../src/projects/calendar-sync.service';
import { ProactiveSchedulerService } from '../../../src/projects/proactive-scheduler.service';
import { RealtimeService } from '../../../src/realtime/realtime.service';
import { TrackingGateway } from '../../../src/tracking/tracking.gateway';
import { USERS, W, buildRbacPrisma } from '../../support/rbac-fixture';

/**
 * S12 : tests d'abus. Fixture : workspace W, projets P1 et P2, un CLIENT/COMMENTER/CONTRIBUTOR de
 * P1, un MEMBER et un VIEWER sans rôle projet. Aucun ne doit voir ni modifier P2, et seuls les
 * rôles prévus par la matrice agissent sur P1.
 */
describe('S12 : cloisonnement par projet dans les services', () => {
  const firestoreSync = { enqueue: jest.fn().mockResolvedValue(undefined) };
  let prisma: ReturnType<typeof buildRbacPrisma> & Record<string, any>;

  const refused = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toThrow(/Forbidden|Workspace|Accès|Permission|Unauthorized/i);
  };

  const compile = async (providers: any[]) => {
    const module = await Test.createTestingModule({
      providers: [
        PolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirestoreSyncService, useValue: firestoreSync },
        ...providers,
      ],
    }).compile();
    return module;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildRbacPrisma() as any;
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  });

  describe('getProjects', () => {
    let service: ProjectsService;
    beforeEach(async () => {
      const module = await compile([
        ProjectsService,
        { provide: NotesService, useValue: {} },
        { provide: IntegrationService, useValue: {} },
        { provide: TasksService, useValue: {} },
        { provide: DependenciesService, useValue: {} },
        { provide: TimeBlocksService, useValue: {} },
        { provide: MilestonesService, useValue: {} },
        { provide: ResourcesService, useValue: {} },
        { provide: FinancesService, useValue: {} },
        { provide: ProjectPermissionsService, useValue: {} },
        { provide: RealtimeService, useValue: {} },
      ]);
      service = module.get(ProjectsService);
    });

    it.each([
      ['owner', ['P1', 'P2']],
      ['admin', ['P1', 'P2']],
      ['client', ['P1']],
      ['commenter', ['P1']],
      ['contributor', ['P1']],
      ['member', []],
      ['viewer', []],
    ] as const)('%s ne reçoit que %j', async (persona, expected) => {
      const projects = await service.getProjects(USERS[persona]);
      expect(projects.map((p: any) => p.id).sort()).toEqual(expected);
    });
  });

  describe('commentaires et pièces jointes', () => {
    let service: CommentsService;
    beforeEach(async () => {
      prisma.comment = {
        findFirst: jest.fn().mockResolvedValue({ id: 'C0', taskId: 'T1' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'C1'
            ? {
                id: 'C1',
                taskId: 'T1',
                userId: USERS.contributor,
                task: { projectId: 'P1', project: { id: 'P1', workspaceId: W } },
              }
            : null,
        ),
        create: jest.fn(async ({ data }: any) => ({
          id: 'C-new',
          ...data,
          attachments: [],
          user: { id: data.userId, name: 'N', email: 'n@x.com' },
        })),
        delete: jest.fn(async ({ where }: any) => ({ id: where.id, taskId: 'T1' })),
        update: jest.fn(),
      };
      prisma.attachment = {
        create: jest.fn(async ({ data }: any) => ({ id: 'A-new', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'A1'
            ? {
                id: 'A1',
                taskId: 'T1',
                uploadedById: USERS.contributor,
                task: { projectId: 'P1', project: { id: 'P1', workspaceId: W } },
              }
            : null,
        ),
        delete: jest.fn(async ({ where }: any) => ({ id: where.id })),
      };
      prisma.membership.findMany = jest.fn().mockResolvedValue([]);
      const module = await compile([
        CommentsService,
        { provide: IntegrationService, useValue: { sendNotification: jest.fn() } },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
      ]);
      service = module.get(CommentsService);
    });

    it.each([
      ['viewer', 'T1'],
      ['member', 'T1'],
      ['client', 'T1'],
      ['commenter', 'T2'],
      ['contributor', 'T2'],
    ] as const)('createComment : %s sur %s est refusé', async (persona, taskId) => {
      await refused(service.createComment(taskId, USERS[persona], 'Bonjour'));
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });

    it.each([
      ['commenter', 'T1'],
      ['contributor', 'T1'],
      ['admin', 'T2'],
    ] as const)('createComment : %s sur %s est accepté', async (persona, taskId) => {
      await expect(service.createComment(taskId, USERS[persona], 'Bonjour')).resolves.toBeDefined();
    });

    it.each([
      ['viewer', 'T1'],
      ['member', 'T1'],
      ['client', 'T2'],
      ['commenter', 'T2'],
    ] as const)('listComments : %s sur %s est refusé', async (persona, taskId) => {
      await refused(service.listComments(taskId, USERS[persona]));
    });

    it('listComments : un CLIENT lit les commentaires de son projet', async () => {
      await expect(service.listComments('T1', USERS.client)).resolves.toEqual([]);
    });

    it.each([
      ['client', 'T1'],
      ['viewer', 'T1'],
      ['commenter', 'T2'],
    ] as const)('createAttachmentForTask : %s sur %s est refusé', async (persona, taskId) => {
      await refused(
        service.createAttachmentForTask(taskId, USERS[persona], 'f.png', 'data:x', 'image/png', 1),
      );
      expect(prisma.attachment.create).not.toHaveBeenCalled();
    });

    it.each([
      ['viewer', 'T1'],
      ['client', 'T2'],
    ] as const)('getAttachmentsForTask : %s sur %s est refusé', async (persona, taskId) => {
      await refused(service.getAttachmentsForTask(taskId, USERS[persona]));
    });

    it.each(['viewer', 'member', 'client', 'commenter'] as const)(
      'deleteAttachment : %s (ni auteur ni MANAGER) est refusé',
      async (persona) => {
        await refused(service.deleteAttachment('A1', USERS[persona]));
        expect(prisma.attachment.delete).not.toHaveBeenCalled();
      },
    );

    it.each(['contributor', 'admin', 'owner'] as const)(
      'deleteAttachment : %s (auteur ou MANAGER) est accepté',
      async (persona) => {
        await expect(service.deleteAttachment('A1', USERS[persona])).resolves.toBeDefined();
      },
    );

    it.each(['viewer', 'member', 'client', 'commenter'] as const)(
      'deleteComment : %s (ni auteur ni MANAGER) est refusé',
      async (persona) => {
        await refused(service.deleteComment('C1', USERS[persona]));
        expect(prisma.comment.delete).not.toHaveBeenCalled();
      },
    );

    it('deleteComment : un auteur qui a perdu l’accès au projet est refusé', async () => {
      prisma.projectMembership.findUnique = jest.fn().mockResolvedValue(null);
      await refused(service.deleteComment('C1', USERS.contributor));
    });
  });

  describe('sprints', () => {
    let service: SprintService;
    beforeEach(async () => {
      prisma.sprint = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'S1',
          workspaceId: W,
          name: 'S',
          status: 'PLANNED',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-01-14'),
        }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }: any) => ({ id: 'S-new', ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 'S1', ...data })),
        delete: jest.fn(async () => ({ id: 'S1' })),
      };

      const module = await compile([SprintService]);
      service = module.get(SprintService);
    });
    const dto = { name: 'S', startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-14T00:00:00Z' };

    it.each(['viewer', 'client'] as const)('un %s ne crée pas de sprint', async (persona) => {
      await refused(service.createSprint(W, USERS[persona], dto as any));
      expect(prisma.sprint.create).not.toHaveBeenCalled();
    });
    it('un VIEWER ne modifie pas un sprint', async () => {
      await refused(service.updateSprint('S1', USERS.viewer, { name: 'x' } as any));
      expect(prisma.sprint.update).not.toHaveBeenCalled();
    });
    it('un VIEWER ne supprime pas un sprint', async () => {
      await refused(service.deleteSprint('S1', USERS.viewer));
      expect(prisma.sprint.delete).not.toHaveBeenCalled();
    });
    it('un MEMBER gère les sprints', async () => {
      await expect(service.createSprint(W, USERS.member, dto as any)).resolves.toBeDefined();
    });
    it('un VIEWER ne lit pas la liste des sprints (P11)', async () => {
      await refused(service.listSprints(W, USERS.viewer));
    });
    it('listSprints n’expose que les tâches des projets accessibles', async () => {
      await service.listSprints(W, USERS.contributor);
      const args = prisma.sprint.findMany.mock.calls[0][0];
      expect(args.include.tasks.where.projectId).toEqual({ in: ['P1'] });
    });
  });

  describe('suivi du temps', () => {
    let service: TrackingService;
    beforeEach(async () => {
      prisma.timeLog = {
        create: jest.fn(async ({ data }: any) => ({ id: 'L1', ...data, task: { project: {} } })),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      };
      const module = await compile([TrackingService]);
      service = module.get(TrackingService);
    });

    it.each([
      ['client', 'T1'],
      ['commenter', 'T1'],
      ['viewer', 'T1'],
      ['member', 'T1'],
      ['contributor', 'T2'],
    ] as const)('startTracking : %s sur %s est refusé', async (persona, taskId) => {
      await expect(service.startTracking(USERS[persona], taskId)).rejects.toThrow();
      expect(prisma.timeLog.create).not.toHaveBeenCalled();
    });

    it('startTracking : un CONTRIBUTOR de P1 démarre un minuteur sur T1', async () => {
      await expect(service.startTracking(USERS.contributor, 'T1')).resolves.toBeDefined();
    });

    it.each([
      ['client', 'T1'],
      ['viewer', 'T1'],
      ['contributor', 'T2'],
    ] as const)('getTimeLogsForTask : %s sur %s est refusé', async (persona, taskId) => {
      await expect(service.getTimeLogsForTask(USERS[persona], taskId)).rejects.toThrow();
      expect(prisma.timeLog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('copilote', () => {
    it('les alertes ne portent que sur les projets accessibles', async () => {
      const policyQuery = prisma.project.findMany;
      prisma.project.findMany = jest.fn(async (args: any) =>
        args.include
          ? buildRbacPrisma()
              .data.projects.filter((p: any) => args.where.id.in.includes(p.id))
              .map((p: any) => ({ ...p, tasks: [] }))
          : policyQuery(args),
      );
      prisma.resourceProfile = { findMany: jest.fn().mockResolvedValue([]) };
      const memberQuery = prisma.membership.findMany;
      prisma.membership.findMany = jest.fn(async (args: any) =>
        (await memberQuery(args)).map((m: any) => ({
          ...m,
          user: { name: m.userId, email: `${m.userId}@x.com` },
        })),
      );
      const module = await compile([CopilotService, { provide: GeminiService, useValue: {} }]);
      const service = module.get(CopilotService);
      await service.calculatePredictiveAlerts(W, USERS.client);
      const queried = prisma.project.findMany.mock.calls
        .filter(([args]: any) => args.include)
        .map(([args]: any) => args.where);
      expect(queried.length).toBeGreaterThan(0);
      for (const where of queried) {
        expect(where.id).toEqual({ in: ['P1'] });
      }
    });
  });

  describe('planification automatique et conflits de calendrier', () => {
    let service: ProactiveSchedulerService;
    const calendar = { detectCalendarConflicts: jest.fn().mockResolvedValue([]) };
    beforeEach(async () => {
      (prisma.task as any).findMany = jest.fn().mockResolvedValue([]);
      prisma.timeBlock = {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      };
      const module = await compile([
        ProactiveSchedulerService,
        { provide: CopilotService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: CalendarSyncService, useValue: calendar },
        { provide: TrackingGateway, useValue: {} },
        { provide: RealtimeService, useValue: { emitSignalToWorkspace: jest.fn() } },
      ]);
      service = module.get(ProactiveSchedulerService);
    });

    it.each([
      ['contributor', ['P1']],
      ['member', []],
    ] as const)('autoScheduleWorkspace : %s ne replanifie que %j', async (persona, expected) => {
      await service.autoScheduleWorkspace(W, USERS[persona]);
      const where = (prisma.task as any).findMany.mock.calls[0][0].where;
      expect(where.project.id).toEqual({ in: expected });
    });

    it('autoScheduleWorkspace : un VIEWER est refusé', async () => {
      await refused(service.autoScheduleWorkspace(W, USERS.viewer));
    });

    it('les conflits de calendrier se bornent aux projets accessibles', async () => {
      calendar.detectCalendarConflicts.mockClear();
      (prisma.task as any).findMany.mockResolvedValue([{ id: 'T1', assignees: [], project: {} }]);
      prisma.timeBlock.count.mockResolvedValue(0);
      await service.autoScheduleWorkspace(W, USERS.contributor);
      expect(calendar.detectCalendarConflicts).toHaveBeenCalledWith(W, ['P1']);
    });
  });

  describe('S12-e : taux de coût et de facturation de la capacité des ressources', () => {
    let service: ResourcesService;
    beforeEach(async () => {
      prisma.workspace = { create: jest.fn() };
      prisma.resourceProfile = {
        findMany: jest.fn(async () =>
          Object.values(USERS).map((userId) => ({
            userId,
            weeklyCapacityMinutes: 2400,
            skills: 'ts',
            costRateCents: 12345,
            billingRateCents: 67890,
          })),
        ),
        upsert: jest.fn(),
      };
      (prisma.task as any).findMany = jest.fn(async () => []);
      for (const model of ['timeBlock', 'resourceAllocation', 'resourceLeave']) {
        prisma[model] = { findMany: jest.fn(async () => []) };
      }
      const members = prisma.membership.findMany;
      prisma.membership.findMany = jest.fn(async (args: any) =>
        (await members(args)).map((m: any) => ({
          ...m,
          user: { id: m.userId, name: m.userId, email: `${m.userId}@x.com` },
        })),
      );
      const module = await compile([ResourcesService]);
      service = module.get(ResourcesService);
    });

    it.each(['member', 'contributor'] as const)(
      '%s : aucun taux dans la réponse',
      async (persona) => {
        const report = await service.getResourceCapacityReport(USERS[persona], W);
        expect(report.length).toBeGreaterThan(0);
        expect(JSON.stringify(report)).not.toMatch(/costRateCents|billingRateCents|12345|67890/);
        // le reste du profil et le calcul de charge restent disponibles
        expect(report[0].weeklyCapacityMinutes).toBe(2400);
      },
    );

    it.each(['owner', 'admin'] as const)('%s : taux conservés', async (persona) => {
      const report = await service.getResourceCapacityReport(USERS[persona], W);
      expect(report[0].profile).toEqual(
        expect.objectContaining({ costRateCents: 12345, billingRateCents: 67890 }),
      );
    });
  });

  describe('S12-f : optimisation de la charge, candidats limités à task.read', () => {
    let service: ResourcesService;
    beforeEach(async () => {
      prisma.resourceProfile = {
        findMany: jest.fn(async () => []),
        upsert: jest.fn(),
        findUnique: jest.fn(async () => null),
        create: jest.fn(),
      };
      prisma.taskAssignee = { deleteMany: jest.fn(), create: jest.fn() };
      for (const model of ['timeBlock', 'resourceAllocation', 'resourceLeave']) {
        prisma[model] = { findMany: jest.fn(async () => []) };
      }
      // 6 tâches ouvertes dans P2 : seuls OWNER et ADMIN y ont un rôle
      (prisma.task as any).findMany = jest.fn(async () =>
        Array.from({ length: 6 }, (_, i) => ({
          id: `OT${i}`,
          projectId: 'P2',
          priority: 'MEDIUM',
          estimatedMinutes: 60,
          assignees: [],
        })),
      );
      const members = prisma.membership.findMany;
      prisma.membership.findMany = jest.fn(async (args: any) =>
        (await members(args)).map((m: any) => ({
          ...m,
          user: { id: m.userId, name: m.userId, email: `${m.userId}@x.com` },
        })),
      );
      const module = await compile([ResourcesService]);
      service = module.get(ResourcesService);
    });

    it('un membre sans rôle sur le projet n’est jamais choisi', async () => {
      const result = await service.optimizeWorkspaceResources(W, USERS.owner);
      const chosen = prisma.taskAssignee.create.mock.calls.map((c: any) => c[0].data.userId);
      expect(result.reallocatedCount).toBe(6);
      expect(chosen.length).toBe(6);
      for (const userId of chosen) expect([USERS.owner, USERS.admin]).toContain(userId);
      expect(chosen).not.toContain(USERS.viewer);
      expect(chosen).not.toContain(USERS.member);
    });

    it('une tâche sans candidat autorisé n’est pas réassignée', async () => {
      (prisma.task as any).findMany = jest.fn(async () => [
        { id: 'OT-x', projectId: 'absent', priority: 'LOW', estimatedMinutes: 60, assignees: [] },
      ]);
      const result = await service.optimizeWorkspaceResources(W, USERS.owner);
      expect(result.reallocatedCount).toBe(0);
      expect(prisma.taskAssignee.create).not.toHaveBeenCalled();
    });
  });

  describe('S12-b : livrables et rapport de livraison', () => {
    let service: MilestonesService;
    beforeEach(async () => {
      const module = await compile([MilestonesService]);
      service = module.get(MilestonesService);
    });

    it('projet inexistant : 404 (et non 500)', async () => {
      await expect(service.getDeliveryReport('absent', USERS.owner)).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each(['client', 'viewer', 'member', 'outsider', 'deprovisioned'] as const)(
      'rapport de P2 pour %s : 403, aucune donnée lue',
      async (persona) => {
        (prisma.project as any).findFirst.mockClear();
        await expect(service.getDeliveryReport('P2', USERS[persona])).rejects.toThrow(
          ForbiddenException,
        );
      },
    );

    it('un MEMBER sans rôle ne coche pas la checklist : 403 et aucune écriture', async () => {
      prisma.deliveryChecklistItem = {
        findFirst: jest.fn().mockResolvedValue({
          id: 'I2',
          delivery: { project: { id: 'P2', workspaceId: W } },
        }),
        update: jest.fn(),
      };
      await expect(service.toggleDeliveryChecklistItem('I2', USERS.member)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.deliveryChecklistItem.update).not.toHaveBeenCalled();
    });
  });

  it('un utilisateur inconnu du workspace ne voit pas P1 par un chemin détourné (404 jamais 200)', async () => {
    const module = await compile([]);
    const policy = module.get(PolicyService);
    await expect(policy.assertTask('T1', USERS.outsider, 'task.read')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(policy.assertTask('T404', USERS.owner, 'task.read')).rejects.toThrow(
      NotFoundException,
    );
  });
});
