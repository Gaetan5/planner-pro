/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PolicyService } from '../../../src/authz/policy.service';
import { WORKSPACE_PERMISSIONS } from '../../../src/authz/permissions';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';
import { NotesService } from '../../../src/notes/notes.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
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
import { RealtimeService } from '../../../src/realtime/realtime.service';
import { USERS, W, buildRbacPrisma } from '../../support/rbac-fixture';

/**
 * P11 : un VIEWER (invité externe de projet) ne voit ni l'annuaire complet du workspace, ni les
 * sprints, ni la capacité, ni les intégrations. Fixture : 7 membres de W ; `client` est VIEWER avec
 * CLIENT sur P1 ; `member` n'a accès à aucun projet.
 */
describe('P11 : VIEWER sans annuaire, sprints, capacité ni intégrations', () => {
  let prisma: any;
  let policy: PolicyService;
  const module = async (providers: any[]) =>
    Test.createTestingModule({
      providers: [
        PolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirestoreSyncService, useValue: { enqueue: jest.fn() } },
        ...providers,
      ],
    }).compile();

  const ids = (...personas: Array<keyof typeof USERS>) => personas.map((p) => USERS[p]).sort();

  beforeEach(async () => {
    prisma = buildRbacPrisma() as any;
    // Les membres exposent leur utilisateur, comme la vraie requête `include`
    const members = prisma.membership.findMany;
    prisma.membership.findMany = jest.fn(async (args: any) => {
      const rows = await members(args);
      const only = args?.where?.userId?.in as string[] | undefined;
      return rows
        .filter((m: any) => !only || only.includes(m.userId))
        .map((m: any) => ({
          ...m,
          user: { id: m.userId, name: m.userId, email: `${m.userId}@x.com` },
        }));
    });
    prisma.workspace = {
      findMany: jest.fn(async () => [
        {
          id: W,
          name: 'W',
          memberships: await prisma.membership.findMany({ where: { workspaceId: W } }),
          teams: [],
        },
      ]),
    };
    policy = (await module([])).get(PolicyService);
  });

  describe('matrice', () => {
    it('sprint.read et workspace.directory.read : OWNER, ADMIN, MEMBER seulement', () => {
      expect([...WORKSPACE_PERMISSIONS['sprint.read']]).toEqual(['OWNER', 'ADMIN', 'MEMBER']);
      expect([...(WORKSPACE_PERMISSIONS as any)['workspace.directory.read']]).toEqual([
        'OWNER',
        'ADMIN',
        'MEMBER',
      ]);
      expect([...WORKSPACE_PERMISSIONS['workspace.read']]).toContain('VIEWER');
    });
  });

  describe('PolicyService.listVisibleWorkspaceMemberIds', () => {
    const visible = async (persona: keyof typeof USERS) =>
      ((await (policy as any).listVisibleWorkspaceMemberIds(W, USERS[persona])) as string[]).sort();

    it('VIEWER invité sur P1 : lui-même, OWNER/ADMIN et les membres de P1 ; ni member ni viewer', async () => {
      expect(await visible('client')).toEqual(
        ids('client', 'owner', 'admin', 'contributor', 'commenter'),
      );
    });

    it('VIEWER sans projet : lui-même et les OWNER/ADMIN', async () => {
      expect(await visible('viewer')).toEqual(ids('viewer', 'owner', 'admin'));
    });

    it('contrôle positif : un MEMBER voit les 7 membres', async () => {
      expect(await visible('member')).toEqual(
        ids('owner', 'admin', 'member', 'contributor', 'commenter', 'viewer', 'client'),
      );
    });

    describe("créateur d'un projet accessible (règle P10)", () => {
      const addProjectCreatedBy = (creator: keyof typeof USERS) => {
        prisma.data.projects.push({
          id: 'PC',
          name: 'Projet PC',
          userId: USERS[creator],
          workspaceId: W,
          deletedAt: null,
        });
        prisma.data.projectMemberships.push({
          id: 'pmc',
          projectId: 'PC',
          userId: USERS.client,
          role: 'CLIENT',
        });
      };

      it("créé par un MEMBER sans ProjectMembership : le créateur figure dans l'annuaire de client", async () => {
        addProjectCreatedBy('member');
        expect(await visible('client')).toContain(USERS.member);
      });

      it("créé par un VIEWER sans ProjectMembership : le créateur n'y figure pas", async () => {
        addProjectCreatedBy('viewer');
        expect(await visible('client')).not.toContain(USERS.viewer);
      });
    });

    it('un compte déprovisionné (ProjectMembership sans Membership) n’apparaît jamais', async () => {
      expect(await visible('client')).not.toContain(USERS.deprovisioned);
    });

    it('un non-membre du workspace : 403', async () => {
      await expect(
        (policy as any).listVisibleWorkspaceMemberIds(W, USERS.outsider),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('ProjectsService', () => {
    let service: ProjectsService;
    beforeEach(async () => {
      service = (
        await module([
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
        ])
      ).get(ProjectsService);
    });

    it('getWorkspaceMembers : un VIEWER invité ne reçoit ni member ni son adresse', async () => {
      const result = await service.getWorkspaceMembers(USERS.client, W);
      expect(result.map((m: any) => m.userId).sort()).toEqual(
        ids('client', 'owner', 'admin', 'contributor', 'commenter'),
      );
      expect(JSON.stringify(result)).not.toContain(`${USERS.member}@x.com`);
    });

    it('getWorkspaceMembers : un MEMBER voit tout le monde', async () => {
      const result = await service.getWorkspaceMembers(USERS.member, W);
      expect(result).toHaveLength(7);
    });

    it('getWorkspaces : même filtrage pour un VIEWER, annuaire complet pour un MEMBER', async () => {
      const asClient: any[] = await service.getWorkspaces(USERS.client);
      expect(asClient[0].memberships.map((m: any) => m.userId).sort()).toEqual(
        ids('client', 'owner', 'admin', 'contributor', 'commenter'),
      );
      const asMember: any[] = await service.getWorkspaces(USERS.member);
      expect(asMember[0].memberships).toHaveLength(7);
    });
  });

  describe('sprints, capacité, intégrations', () => {
    it.each(['viewer', 'client'] as const)(
      '%s : liste, vélocité et détail de sprint refusés',
      async (p) => {
        prisma.sprint = {
          findUnique: jest.fn().mockResolvedValue({ id: 'S1', workspaceId: W }),
          findMany: jest.fn().mockResolvedValue([]),
        };
        const sprints = (await module([SprintService])).get(SprintService);
        await expect(sprints.listSprints(W, USERS[p])).rejects.toThrow(ForbiddenException);
        await expect(sprints.getAverageVelocity(W, USERS[p])).rejects.toThrow(ForbiddenException);
        await expect(sprints.getBurndownChart('S1', USERS[p])).rejects.toThrow(ForbiddenException);
      },
    );

    it('contrôle positif : un MEMBER lit les sprints', async () => {
      prisma.sprint = { findMany: jest.fn().mockResolvedValue([]) };
      const sprints = (await module([SprintService])).get(SprintService);
      await expect(sprints.listSprints(W, USERS.member)).resolves.toEqual([]);
    });

    it.each(['viewer', 'client'] as const)(
      '%s : rapport de capacité refusé, aucune lecture',
      async (p) => {
        prisma.workspace = { create: jest.fn() };
        prisma.resourceProfile = { findMany: jest.fn(), upsert: jest.fn() };
        const resources = (await module([ResourcesService])).get(ResourcesService);
        await expect(resources.getResourceCapacityReport(USERS[p], W)).rejects.toThrow(
          ForbiddenException,
        );
        expect(prisma.resourceProfile.upsert).not.toHaveBeenCalled();
      },
    );
  });

  describe("P11-a : absences d'un autre utilisateur", () => {
    let resources: ResourcesService;
    beforeEach(async () => {
      prisma.resourceLeave = { findMany: jest.fn().mockResolvedValue([{ id: 'L1', reason: 'x' }]) };
      resources = (await module([ResourcesService])).get(ResourcesService);
    });

    it.each(['client', 'viewer'] as const)(
      '%s (VIEWER) : les absences de owner sont refusées, sans lecture',
      async (p) => {
        await expect(resources.getResourceLeaves(USERS[p], USERS.owner)).rejects.toThrow(
          ForbiddenException,
        );
        expect(prisma.resourceLeave.findMany).not.toHaveBeenCalled();
      },
    );

    it('un VIEWER lit ses propres absences', async () => {
      await expect(resources.getResourceLeaves(USERS.client, USERS.client)).resolves.toHaveLength(
        1,
      );
    });

    it('contrôle positif : un MEMBER lit les absences de owner', async () => {
      await expect(resources.getResourceLeaves(USERS.member, USERS.owner)).resolves.toHaveLength(1);
    });

    it("un utilisateur d'un autre workspace : 403", async () => {
      await expect(resources.getResourceLeaves(USERS.outsider, USERS.owner)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.resourceLeave.findMany).not.toHaveBeenCalled();
    });
  });
});
