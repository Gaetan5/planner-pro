/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PolicyService } from '../../../src/authz/policy.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { USERS, W, buildRbacPrisma } from '../../support/rbac-fixture';

/**
 * P10 : le créateur d'un projet de workspace n'en est MANAGER que s'il est au moins MEMBER. Un
 * créateur rétrogradé VIEWER retombe sur sa `ProjectMembership` éventuelle. Vrai PolicyService,
 * fixture RBAC : chacune des trois méthodes qui appliquent la règle a son test.
 */
describe('P10 : créateur de projet et rôle de workspace', () => {
  const C = '00000000-0000-4000-8000-0000000000c1';
  let prisma: any;
  let policy: PolicyService;

  const setup = async (workspaceRole: string, projectRole?: string) => {
    prisma = buildRbacPrisma() as any;
    prisma.data.memberships.push({ id: 'mc', workspaceId: W, userId: C, role: workspaceRole });
    prisma.data.projects.push({
      id: 'PC',
      name: 'Projet C',
      userId: C,
      workspaceId: W,
      deletedAt: null,
    });
    if (projectRole) {
      prisma.data.projectMemberships.push({
        id: 'pmc',
        projectId: 'PC',
        userId: C,
        role: projectRole,
      });
    }
    const module = await Test.createTestingModule({
      providers: [PolicyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    policy = module.get(PolicyService);
  };

  describe('créateur VIEWER sans ProjectMembership', () => {
    beforeEach(() => setup('VIEWER'));

    it('effectiveProjectRole / assertProject : 403', async () => {
      await expect(policy.assertProject('PC', C, 'project.read')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('listAccessibleProjectIds : le projet est absent', async () => {
      expect(await policy.listAccessibleProjectIds(C)).not.toContain('PC');
      expect(await policy.listAccessibleProjectIds(C, { workspaceId: W })).not.toContain('PC');
    });

    it('filterUsersWithProjectAction : le créateur est absent', async () => {
      expect(await policy.filterUsersWithProjectAction('PC', [C], 'task.read')).toEqual([]);
    });
  });

  describe('créateur VIEWER avec une ProjectMembership CLIENT', () => {
    beforeEach(() => setup('VIEWER', 'CLIENT'));

    it('lecture permise, écriture refusée, dans les trois méthodes', async () => {
      await expect(policy.assertProject('PC', C, 'project.read')).resolves.toBeDefined();
      await expect(policy.assertProject('PC', C, 'task.write')).rejects.toThrow(ForbiddenException);
      expect(await policy.listAccessibleProjectIds(C)).toContain('PC');
      expect(await policy.listAccessibleProjectIds(C, { action: 'task.write' })).not.toContain(
        'PC',
      );
      expect(await policy.filterUsersWithProjectAction('PC', [C], 'task.read')).toEqual([C]);
      expect(await policy.filterUsersWithProjectAction('PC', [C], 'task.write')).toEqual([]);
    });
  });

  describe('contrôle positif : créateur MEMBER', () => {
    beforeEach(() => setup('MEMBER'));

    it('reste MANAGER dans les trois méthodes', async () => {
      await expect(policy.assertProject('PC', C, 'project.manage')).resolves.toBeDefined();
      expect(await policy.listAccessibleProjectIds(C, { action: 'project.manage' })).toContain(
        'PC',
      );
      expect(await policy.filterUsersWithProjectAction('PC', [C], 'project.manage')).toEqual([C]);
    });
  });

  it('projet personnel (sans workspace) : le créateur reste MANAGER', async () => {
    await setup('VIEWER');
    prisma.data.projects.push({
      id: 'PP',
      name: 'Perso',
      userId: C,
      workspaceId: null,
      deletedAt: null,
    });
    await expect(policy.assertProject('PP', C, 'project.manage')).resolves.toBeDefined();
    expect(await policy.listAccessibleProjectIds(C)).toContain('PP');
  });

  it('un créateur OWNER (fixture) reste MANAGER', async () => {
    await setup('MEMBER');
    await expect(policy.assertProject('P1', USERS.owner, 'project.manage')).resolves.toBeDefined();
  });
});
