import { Test, TestingModule } from '@nestjs/testing';
import { ProjectPermissionsService } from '../../../src/projects/project-permissions.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectRole } from '@prisma/client';

describe('ProjectPermissionsService', () => {
  let service: ProjectPermissionsService;
  let prisma: PrismaService;

  const mockPrisma = {
    project: {
      findFirst: jest.fn(),
    },
    membership: {
      findFirst: jest.fn(),
    },
    projectMembership: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectPermissionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ProjectPermissionsService>(ProjectPermissionsService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('assertProjectRole', () => {
    it('devrait lever une erreur NotFoundException si le projet n\'existe pas', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);

      await expect(
        service.assertProjectRole('invalid-project', 'user-1', ['MANAGER']),
      ).rejects.toThrow(NotFoundException);
    });

    it('devrait autoriser le créateur direct du projet sans vérifier le rôle de workspace ou de projet', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        userId: 'creator-user', // L'utilisateur appelant est le créateur
        workspaceId: 'ws-123',
      });

      await expect(
        service.assertProjectRole('proj-1', 'creator-user', ['MANAGER']),
      ).resolves.not.toThrow();
    });

    it('devrait autoriser un OWNER du workspace parent par défaut avec des droits MANAGER', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        userId: 'creator-user',
        workspaceId: 'ws-123',
      });
      mockPrisma.membership.findFirst.mockResolvedValue({
        userId: 'workspace-owner-user',
        role: 'OWNER',
      });

      await expect(
        service.assertProjectRole('proj-1', 'workspace-owner-user', ['MANAGER']),
      ).resolves.not.toThrow();
    });

    it('devrait lever ForbiddenException si l\'utilisateur n\'a aucun lien avec le projet', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        userId: 'creator-user',
        workspaceId: 'ws-123',
      });
      mockPrisma.membership.findFirst.mockResolvedValue(null); // Pas membre workspace
      mockPrisma.projectMembership.findUnique.mockResolvedValue(null); // Pas membre projet

      await expect(
        service.assertProjectRole('proj-1', 'stranger-user', ['MANAGER']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('devrait autoriser un CLIENT pour un accès CLIENT', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        userId: 'creator-user',
        workspaceId: 'ws-123',
      });
      mockPrisma.membership.findFirst.mockResolvedValue(null);
      mockPrisma.projectMembership.findUnique.mockResolvedValue({
        userId: 'client-user',
        role: 'CLIENT',
      });

      await expect(
        service.assertProjectRole('proj-1', 'client-user', ['CLIENT']),
      ).resolves.not.toThrow();
    });

    it('devrait rejeter un CLIENT si le rôle minimum requis est CONTRIBUTOR', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        userId: 'creator-user',
        workspaceId: 'ws-123',
      });
      mockPrisma.membership.findFirst.mockResolvedValue(null);
      mockPrisma.projectMembership.findUnique.mockResolvedValue({
        userId: 'client-user',
        role: 'CLIENT',
      });

      await expect(
        service.assertProjectRole('proj-1', 'client-user', ['CONTRIBUTOR']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('devrait autoriser un CONTRIBUTOR si le rôle minimum requis est COMMENTER (hiérarchie des rôles)', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        userId: 'creator-user',
        workspaceId: 'ws-123',
      });
      mockPrisma.membership.findFirst.mockResolvedValue(null);
      mockPrisma.projectMembership.findUnique.mockResolvedValue({
        userId: 'contrib-user',
        role: 'CONTRIBUTOR',
      });

      await expect(
        service.assertProjectRole('proj-1', 'contrib-user', ['COMMENTER']),
      ).resolves.not.toThrow();
    });
  });

  describe('assignProjectRole', () => {
    it('devrait insérer un log d\'audit lors d\'une attribution de rôle réussie', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        userId: 'actor-user',
        workspaceId: 'ws-123',
      });
      mockPrisma.projectMembership.upsert.mockResolvedValue({
        id: 'pm-123',
        projectId: 'proj-1',
        userId: 'target-user',
        role: 'CONTRIBUTOR',
      });

      await service.assignProjectRole('proj-1', 'target-user', ProjectRole.CONTRIBUTOR, 'actor-user');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          userId: 'actor-user',
          action: 'PROJECT_ROLE_ASSIGN',
          entityType: 'ProjectMembership',
        }),
      }));
    });
  });
});
