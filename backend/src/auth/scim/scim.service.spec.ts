import { Test, TestingModule } from '@nestjs/testing';
import { ScimService } from './scim.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('ScimService', () => {
  let service: ScimService;

  const prisma = {
    membership: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    sCIMApiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScimService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ScimService>(ScimService);
    jest.resetAllMocks();
  });

  describe('getServiceProviderConfig', () => {
    it('renvoie les métadonnées de conformité SCIM 2.0', () => {
      const config = service.getServiceProviderConfig();
      expect(config.schemas).toContain(
        'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
      );
      expect(config.patch.supported).toBe(true);
      expect(config.authenticationSchemes[0].type).toBe('oauthbearertoken');
    });
  });

  describe('listUsers', () => {
    it('formate la réponse selon RFC 7644 ListResponse', async () => {
      prisma.membership.findMany.mockResolvedValue([
        {
          user: {
            id: 'u-1',
            email: 'dev@enterprise.org',
            name: 'Jean Dupont',
            isSuspended: false,
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        },
      ]);
      prisma.membership.count.mockResolvedValue(1);

      const res = await service.listUsers('ws-1', 1, 10);
      expect(res.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.totalResults).toBe(1);
      expect(res.Resources[0].userName).toBe('dev@enterprise.org');
      expect(res.Resources[0].active).toBe(true);
    });
  });

  // S1 : aucune écriture globale sur User, aucun rattachement silencieux, clés limitées au workspace
  describe('S1 : isolation inter-tenant', () => {
    const victim = (overrides: Record<string, unknown> = {}) => ({
      id: 'u-victim',
      email: 'victime@corp.com',
      name: 'Victime',
      isSuspended: false,
      provisionedByWorkspaceId: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      memberships: [{ workspaceId: 'ws-attaquant', userId: 'u-victim', role: 'MEMBER' }],
      ...overrides,
    });

    const writesTo = (field: string) =>
      prisma.user.update.mock.calls.some(([args]) => args?.data && field in args.data) ||
      prisma.user.updateMany.mock.calls.some(([args]) => args?.data && field in args.data);

    it('POST avec l’e-mail d’un utilisateur existant : 409, aucune membership créée', async () => {
      prisma.user.findUnique.mockResolvedValue(victim({ memberships: [] }));

      await expect(
        service.createUser('ws-attaquant', { userName: 'victime@corp.com' }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.membership.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('POST d’un nouvel utilisateur : rattaché au workspace provisionneur, jamais suspendu globalement', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: 'u-new',
        createdAt: new Date(),
        isSuspended: false,
        ...data,
        memberships: data.memberships ? [{ workspaceId: 'ws-1' }] : [],
      }));

      await service.createUser('ws-1', { userName: 'nouveau@corp.com', active: false });

      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data.provisionedByWorkspaceId).toBe('ws-1');
      expect(data.isSuspended).not.toBe(true);
    });

    it('PUT avec un nouvel userName : User.email n’est jamais modifié', async () => {
      prisma.user.findUnique.mockResolvedValue(victim());
      // Chemin historique : la cible est membre du workspace de l'attaquant
      prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER', user: victim() });
      prisma.user.update.mockImplementation(async ({ data }) => ({ ...victim(), ...data }));

      await service
        .updateUser('ws-attaquant', 'u-victim', { userName: 'attaquant@x.com' })
        .catch(() => undefined);

      expect(writesTo('email')).toBe(false);
      expect(writesTo('isSuspended')).toBe(false);
    });

    it('PUT : le nom d’un utilisateur non provisionné par ce workspace n’est pas modifié', async () => {
      prisma.user.findUnique.mockResolvedValue(victim());
      prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER', user: victim() });
      prisma.user.update.mockImplementation(async ({ data }) => ({ ...victim(), ...data }));

      await service
        .updateUser('ws-attaquant', 'u-victim', {
          userName: 'victime@corp.com',
          displayName: 'Nom imposé',
        })
        .catch(() => undefined);

      expect(writesTo('name')).toBe(false);
    });

    it('PUT : le nom d’un utilisateur provisionné par ce workspace peut être modifié', async () => {
      prisma.user.findUnique.mockResolvedValue(
        victim({
          id: 'u-own',
          provisionedByWorkspaceId: 'ws-1',
          memberships: [{ workspaceId: 'ws-1' }],
        }),
      );
      prisma.user.update.mockImplementation(async ({ data }) => ({
        ...victim({ id: 'u-own' }),
        ...data,
      }));

      await service.updateUser('ws-1', 'u-own', {
        userName: 'victime@corp.com',
        displayName: 'Nouveau Nom',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'Nouveau Nom' } }),
      );
    });

    it('PATCH active=false : User.isSuspended n’est jamais écrit, seule la membership du workspace est retirée', async () => {
      prisma.user.findUnique.mockResolvedValue(victim());

      const res = await service.patchUser('ws-attaquant', 'u-victim', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      });

      expect(writesTo('isSuspended')).toBe(false);
      expect(prisma.membership.delete).toHaveBeenCalledTimes(1);
      expect(prisma.membership.delete).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: 'ws-attaquant', userId: 'u-victim' } },
      });
      expect(res.active).toBe(false);
    });

    it('PATCH active=true : réactive un utilisateur provisionné par ce workspace (membership recréée)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        victim({ id: 'u-own', provisionedByWorkspaceId: 'ws-1', memberships: [] }),
      );

      const res = await service.patchUser('ws-1', 'u-own', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { active: true } }],
      });

      expect(prisma.membership.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', userId: 'u-own', role: 'MEMBER' },
      });
      expect(writesTo('isSuspended')).toBe(false);
      expect(res.active).toBe(true);
    });

    it('un utilisateur ni membre ni provisionné par ce workspace est introuvable (404)', async () => {
      prisma.user.findUnique.mockResolvedValue(victim({ memberships: [] }));

      await expect(service.getUser('ws-attaquant', 'u-victim')).rejects.toThrow(NotFoundException);
      await expect(
        service.patchUser('ws-attaquant', 'u-victim', {
          schemas: [],
          Operations: [{ op: 'replace', path: 'active', value: false }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(writesTo('isSuspended')).toBe(false);
      expect(prisma.membership.delete).not.toHaveBeenCalled();
    });

    it('la membership OWNER ne peut pas être retirée par SCIM', async () => {
      prisma.user.findUnique.mockResolvedValue(
        victim({ memberships: [{ workspaceId: 'ws-1', userId: 'u-victim', role: 'OWNER' }] }),
      );

      await expect(
        service.patchUser('ws-1', 'u-victim', {
          schemas: [],
          Operations: [{ op: 'replace', path: 'active', value: false }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.membership.delete).not.toHaveBeenCalled();
    });

    it('DELETE /scim/keys/<cléDeB> par un OWNER de A : 404, la clé de B n’est pas révoquée', async () => {
      prisma.membership.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.sCIMApiKey.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeApiKey('ws-A', 'owner-A', 'key-B')).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.sCIMApiKey.update).not.toHaveBeenCalled();
      for (const [args] of prisma.sCIMApiKey.updateMany.mock.calls) {
        expect(args.where).toEqual(
          expect.objectContaining({ id: 'key-B', workspaceId: 'ws-A', revokedAt: null }),
        );
      }
    });

    it('révocation d’une clé de son propre workspace : OK', async () => {
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN' });
      prisma.sCIMApiKey.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.revokeApiKey('ws-A', 'admin-A', 'key-A')).resolves.toEqual(
        expect.objectContaining({ id: 'key-A' }),
      );
    });
  });
});
