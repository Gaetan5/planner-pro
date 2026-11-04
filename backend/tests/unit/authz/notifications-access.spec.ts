/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { PolicyService } from '../../../src/authz/policy.service';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';
import { NotesService } from '../../../src/notes/notes.service';
import { NotificationsService } from '../../../src/notifications/notifications.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { CommentsService } from '../../../src/projects/comments.service';
import { IntegrationService } from '../../../src/projects/integration.service';
import { ProjectPermissionsService } from '../../../src/projects/project-permissions.service';
import { TasksService } from '../../../src/projects/tasks.service';
import { USERS, W, buildRbacPrisma } from '../../support/rbac-fixture';

/** S12-c : mentions et assignations ne notifient que des personnes ayant accès au projet. */
describe('S12-c : notifications limitées aux personnes autorisées', () => {
  let prisma: ReturnType<typeof buildRbacPrisma> & Record<string, any>;
  const createNotification = jest.fn();
  const sendNotification = jest.fn();
  const enqueue = jest.fn().mockResolvedValue(undefined);

  const compile = async (providers: any[]) =>
    Test.createTestingModule({
      providers: [
        PolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { createNotification } },
        { provide: IntegrationService, useValue: { sendNotification } },
        { provide: FirestoreSyncService, useValue: { enqueue } },
        ...providers,
      ],
    }).compile();

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildRbacPrisma() as any;
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    // Les membres du workspace, avec nom et e-mail dérivés de l'identifiant (« client », « commenter »...)
    const members = prisma.membership.findMany;
    prisma.membership.findMany = jest.fn(async (args: any) =>
      (await members(args)).map((m: any) => {
        const name = m.userId.replace('u-', '');
        return { ...m, user: { id: m.userId, name, email: `${name}@x.com` } };
      }),
    );
  });

  describe('mentions (CommentsService)', () => {
    let service: CommentsService;
    beforeEach(async () => {
      prisma.comment = {
        findFirst: jest.fn(),
        create: jest.fn(async ({ data }: any) => ({
          id: 'C-new',
          ...data,
          attachments: [],
          user: { id: data.userId, name: 'Auteur', email: 'a@x.com' },
        })),
      };
      const module = await compile([CommentsService]);
      service = module.get(CommentsService);
    });

    it('mention d’un utilisateur sans rôle sur le projet : ni notification ni identifiant renvoyé', async () => {
      // admin commente T2 (P2) et mentionne « client » (CLIENT de P1 seulement) et « viewer »
      const result = await service.createComment('T2', USERS.admin, 'Bonjour @client et @viewer');
      expect(result.mentionedUserIds).toEqual([]);
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('mention d’un COMMENTER du projet : notifié', async () => {
      const result = await service.createComment('T1', USERS.admin, 'Salut @commenter');
      expect(result.mentionedUserIds).toEqual([USERS.commenter]);
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USERS.commenter, type: 'MENTION', projectId: 'P1' }),
      );
    });

    it('une mention non autorisée ne masque pas un homonyme autorisé', async () => {
      const result = await service.createComment('T1', USERS.admin, '@commenter @viewer');
      expect(result.mentionedUserIds).toEqual([USERS.commenter]);
    });
  });

  describe('assignations (TasksService)', () => {
    let service: TasksService;
    beforeEach(async () => {
      prisma.taskAssignee = {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      };
      prisma.user = {
        findUnique: jest.fn().mockResolvedValue({ name: 'Admin', email: 'a@x.com' }),
      };
      prisma.task.findUnique = jest.fn().mockResolvedValue({
        id: 'T1',
        title: 'Tâche 1',
        projectId: 'P1',
        deletedAt: null,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-06-01T00:00:00Z'),
        assignees: [],
        project: { workspaceId: W, userId: USERS.owner },
      });
      const module = await compile([
        TasksService,
        { provide: NotesService, useValue: {} },
        { provide: ProjectPermissionsService, useValue: {} },
      ]);
      service = module.get(TasksService);
    });

    it('assigner un membre du workspace sans rôle sur le projet : ignoré, aucune notification', async () => {
      await service.replaceTaskAssignees(
        'T1',
        'P1',
        [USERS.member, USERS.viewer, USERS.outsider],
        USERS.admin,
      );
      expect(prisma.taskAssignee.createMany).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('assigner un détenteur d’un rôle sur le projet : assigné et notifié', async () => {
      await service.replaceTaskAssignees(
        'T1',
        'P1',
        [USERS.contributor, USERS.member],
        USERS.admin,
      );
      expect(prisma.taskAssignee.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [{ taskId: 'T1', userId: USERS.contributor }] }),
      );
      expect(createNotification).toHaveBeenCalledTimes(1);
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USERS.contributor, type: 'ASSIGNMENT' }),
      );
    });
  });

  describe('PolicyService.filterUsersWithProjectAction', () => {
    it('ne garde que les utilisateurs ayant l’action, dédoublonnés', async () => {
      const policy = new PolicyService(prisma as unknown as PrismaService);
      const ids = await policy.filterUsersWithProjectAction(
        'P1',
        [USERS.client, USERS.client, USERS.member, USERS.admin, USERS.deprovisioned, 'inconnu'],
        'task.read',
      );
      expect(ids.sort()).toEqual([USERS.admin, USERS.client].sort());
    });
    it('action d’écriture : un CLIENT est exclu', async () => {
      const policy = new PolicyService(prisma as unknown as PrismaService);
      expect(
        await policy.filterUsersWithProjectAction(
          'P1',
          [USERS.client, USERS.contributor],
          'task.write',
        ),
      ).toEqual([USERS.contributor]);
    });
    it('projet absent : liste vide', async () => {
      const policy = new PolicyService(prisma as unknown as PrismaService);
      expect(
        await policy.filterUsersWithProjectAction('absent', [USERS.admin], 'task.read'),
      ).toEqual([]);
    });
  });
});
