import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PolicyService } from '../../../src/authz/policy.service';
import { AssignProjectRoleDto } from '../../../src/projects/dto/assign-project-role.dto';
import { ProjectPermissionsService } from '../../../src/projects/project-permissions.service';

/**
 * S17 : `assignProjectRole` ne doit jamais atteindre un utilisateur hors du workspace du projet,
 * et un MANAGER ne peut pas créer d'autres MANAGER (réservé à OWNER/ADMIN du workspace).
 */
describe('S17 : assignProjectRole', () => {
  type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  const memberships: Array<{ workspaceId: string; userId: string; role: Role }> = [];
  const projectMemberships: Array<{ projectId: string; userId: string; role: string }> = [];
  const project = { id: 'p1', userId: 'creator', workspaceId: 'ws1', deletedAt: null };

  const prisma = {
    project: { findFirst: jest.fn(async () => project) },
    membership: {
      findFirst: jest.fn(
        async ({ where }: { where: { workspaceId: string; userId: string } }) =>
          memberships.find(
            (m) => m.workspaceId === where.workspaceId && m.userId === where.userId,
          ) ?? null,
      ),
    },
    projectMembership: {
      findUnique: jest.fn(
        async ({ where }: { where: { projectId_userId: { projectId: string; userId: string } } }) =>
          projectMemberships.find(
            (pm) =>
              pm.projectId === where.projectId_userId.projectId &&
              pm.userId === where.projectId_userId.userId,
          ) ?? null,
      ),
      upsert: jest.fn(
        async ({
          create,
          update,
        }: {
          create: { projectId: string; userId: string; role: string };
          update: { role: string };
        }) => {
          const row = projectMemberships.find(
            (pm) => pm.projectId === create.projectId && pm.userId === create.userId,
          );
          if (row) {
            row.role = update.role;
            return { id: 'pm1', ...row };
          }
          projectMemberships.push(create);
          return { id: 'pm1', ...create };
        },
      ),
    },
    auditLog: { create: jest.fn() },
  };
  // removeProjectRole : suppression de la ligne trouvée
  (prisma.projectMembership as Record<string, unknown>).delete = jest.fn(
    async ({ where }: { where: { id: string } }) => {
      const index = projectMemberships.findIndex((pm) => (pm as { id?: string }).id === where.id);
      if (index >= 0) projectMemberships.splice(index, 1);
      return {};
    },
  );
  const realtime = { refreshUserRooms: jest.fn() };
  let service: ProjectPermissionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    memberships.length = 0;
    projectMemberships.length = 0;
    memberships.push(
      { workspaceId: 'ws1', userId: 'admin', role: 'ADMIN' },
      { workspaceId: 'ws1', userId: 'mgr', role: 'MEMBER' },
      { workspaceId: 'ws1', userId: 'mgr2', role: 'MEMBER' },
      { workspaceId: 'ws1', userId: 'creator', role: 'MEMBER' },
      { workspaceId: 'ws1', userId: 'colleague', role: 'MEMBER' },
      { workspaceId: 'ws2', userId: 'stranger', role: 'OWNER' },
    );
    projectMemberships.push(
      { id: 'pm-mgr', projectId: 'p1', userId: 'mgr', role: 'MANAGER' } as never,
      { id: 'pm-mgr2', projectId: 'p1', userId: 'mgr2', role: 'MANAGER' } as never,
      { id: 'pm-colleague', projectId: 'p1', userId: 'colleague', role: 'CONTRIBUTOR' } as never,
    );
    service = new ProjectPermissionsService(
      prisma as never,
      new PolicyService(prisma as never),
      realtime as never,
    );
  });

  it('cible hors du workspace du projet (membre d’un autre workspace) : 403, rien écrit', async () => {
    await expect(service.assignProjectRole('p1', 'stranger', 'CLIENT', 'mgr')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.projectMembership.upsert).not.toHaveBeenCalled();
    expect(realtime.refreshUserRooms).not.toHaveBeenCalled();
  });

  it('cible inexistante sur la plateforme : 403', async () => {
    await expect(service.assignProjectRole('p1', 'ghost', 'CLIENT', 'mgr')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.projectMembership.upsert).not.toHaveBeenCalled();
  });

  it('un MANAGER de projet (simple MEMBER du workspace) ne peut pas attribuer MANAGER', async () => {
    await expect(service.assignProjectRole('p1', 'colleague', 'MANAGER', 'mgr')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.projectMembership.upsert).not.toHaveBeenCalled();
  });

  it('un MANAGER de projet peut attribuer un rôle inférieur à un membre du workspace', async () => {
    await expect(
      service.assignProjectRole('p1', 'colleague', 'CONTRIBUTOR', 'mgr'),
    ).resolves.toBeDefined();
    expect(prisma.projectMembership.upsert).toHaveBeenCalledTimes(1);
  });

  it('un ADMIN du workspace peut attribuer MANAGER', async () => {
    await expect(
      service.assignProjectRole('p1', 'colleague', 'MANAGER', 'admin'),
    ).resolves.toBeDefined();
  });

  describe('P12 : un MANAGER ne rétrograde ni ne retire un autre MANAGER', () => {
    const roleOf = (userId: string) =>
      projectMemberships.find((pm) => pm.userId === userId)?.role ?? null;

    it('MANAGER (MEMBER du workspace) qui rétrograde un autre MANAGER : 403, rien écrit', async () => {
      await expect(service.assignProjectRole('p1', 'mgr2', 'CONTRIBUTOR', 'mgr')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.projectMembership.upsert).not.toHaveBeenCalled();
      expect(roleOf('mgr2')).toBe('MANAGER');
    });

    it('MANAGER qui retire un autre MANAGER : 403, ligne conservée', async () => {
      await expect(service.removeProjectRole('p1', 'mgr2', 'mgr')).rejects.toThrow(
        ForbiddenException,
      );
      expect(roleOf('mgr2')).toBe('MANAGER');
    });

    it('ADMIN du workspace : rétrograde puis retire un MANAGER', async () => {
      await expect(
        service.assignProjectRole('p1', 'mgr2', 'CONTRIBUTOR', 'admin'),
      ).resolves.toBeDefined();
      await expect(service.removeProjectRole('p1', 'mgr2', 'admin')).resolves.toBeDefined();
      expect(roleOf('mgr2')).toBeNull();
    });

    it('un MANAGER peut se retirer lui-même', async () => {
      await expect(service.removeProjectRole('p1', 'mgr', 'mgr')).resolves.toBeDefined();
      expect(roleOf('mgr')).toBeNull();
    });

    it('contrôle positif : un MANAGER rétrograde ou retire un CONTRIBUTOR', async () => {
      await expect(
        service.assignProjectRole('p1', 'colleague', 'COMMENTER', 'mgr'),
      ).resolves.toBeDefined();
      await expect(service.removeProjectRole('p1', 'colleague', 'mgr')).resolves.toBeDefined();
    });

    it('le créateur du projet ne se retire pas lui-même (son rôle ne dépend pas de la ligne)', async () => {
      await expect(service.removeProjectRole('p1', 'creator', 'creator')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.assignProjectRole('p1', 'creator', 'CLIENT', 'creator')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('DTO', () => {
    const errorsFor = async (body: object) =>
      (await validate(plainToInstance(AssignProjectRoleDto, body), { whitelist: true })).map(
        (e) => e.property,
      );

    it('targetUserId non UUID et rôle inconnu : rejetés', async () => {
      expect(await errorsFor({ targetUserId: 'abc', role: 'GOD' })).toEqual(
        expect.arrayContaining(['targetUserId', 'role']),
      );
    });

    it('corps valide accepté', async () => {
      expect(
        await errorsFor({ targetUserId: '3f1c2d6e-8a41-4b7e-9c55-0d2a1b7e4f10', role: 'CLIENT' }),
      ).toEqual([]);
    });
  });
});
