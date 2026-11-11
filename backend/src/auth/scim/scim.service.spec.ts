import { RealtimeService } from '../../realtime/realtime.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ScimService } from './scim.service';
import { FirestoreSyncService } from '../../firestore-sync/firestore-sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

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
    projectMembership: {
      deleteMany: jest.fn(),
    },
    invitation: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
    sSOConfiguration: {
      findUnique: jest.fn(),
    },
    sCIMApiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const realtime = { refreshUserRooms: jest.fn() };
  const firestoreSync = { enqueue: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScimService,
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeService, useValue: realtime },
        { provide: FirestoreSyncService, useValue: firestoreSync },
      ],
    }).compile();

    service = module.get<ScimService>(ScimService);
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) =>
      cb(prisma),
    );
    prisma.invitation.findMany.mockResolvedValue([]);
    prisma.invitation.updateMany.mockResolvedValue({ count: 1 });
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
  describe('S17 (complément) : DELETE purge les rôles de projet', () => {
    const user = (memberships: unknown[]) => ({
      id: 'u-1',
      email: 'a@corp.com',
      name: 'A',
      isSuspended: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      provisionedByWorkspaceId: null,
      memberships,
    });

    it('DELETE : les ProjectMembership du workspace sont supprimées (et eux seuls)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user([{ workspaceId: 'ws-1', userId: 'u-1', role: 'MEMBER' }]),
      );

      await service.deleteUser('ws-1', 'u-1');

      expect(prisma.membership.delete).toHaveBeenCalledTimes(1);
      expect(prisma.projectMembership.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', project: { workspaceId: 'ws-1' } },
      });
      expect(realtime.refreshUserRooms).toHaveBeenCalledWith('u-1');
    });

    it('DELETE après une suspension (membership déjà retirée) : les rôles de projet sont purgés aussi', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...user([]),
        provisionedByWorkspaceId: 'ws-1',
      });

      await service.deleteUser('ws-1', 'u-1');

      expect(prisma.projectMembership.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', project: { workspaceId: 'ws-1' } },
      });
    });

    it('PATCH active=false (suspension) : les rôles de projet sont conservés', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user([{ workspaceId: 'ws-1', userId: 'u-1', role: 'MEMBER' }]),
      );

      await service.patchUser('ws-1', 'u-1', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      } as never);

      expect(prisma.projectMembership.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('S17-a : invitations en attente révoquées au déprovisionnement', () => {
    const member = {
      id: 'u-1',
      email: 'Ada@Corp.com',
      name: 'Ada',
      isSuspended: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      provisionedByWorkspaceId: null,
      memberships: [{ workspaceId: 'ws-1', userId: 'u-1', role: 'MEMBER' }],
    };
    const pending = {
      id: 'inv-1',
      email: 'ada@corp.com',
      role: 'MEMBER',
      status: 'PENDING',
      workspaceId: 'ws-1',
      projectId: null,
      invitedById: 'adm',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const expectRevoked = () => {
      // Filtre : ce workspace, en attente, adresse en minuscules (jamais une autre organisation)
      expect(prisma.invitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1', status: 'PENDING', email: 'ada@corp.com' },
        }),
      );
      expect(prisma.invitation.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      expect(firestoreSync.enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          entityType: 'invitation',
          entityId: 'inv-1',
          workspaceId: 'ws-1',
          operation: 'upsert',
          payload: expect.objectContaining({ status: 'REVOKED' }),
        }),
      );
    };

    it('DELETE : l’invitation en attente de l’utilisateur est révoquée, événement Firestore émis', async () => {
      prisma.user.findUnique.mockResolvedValue(member);
      prisma.invitation.findMany.mockResolvedValue([pending]);
      await service.deleteUser('ws-1', 'u-1');
      expectRevoked();
    });

    it('PATCH active=false : même révocation', async () => {
      prisma.user.findUnique.mockResolvedValue(member);
      prisma.invitation.findMany.mockResolvedValue([pending]);
      await service.patchUser('ws-1', 'u-1', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      } as never);
      expectRevoked();
    });

    it('PATCH active=true ou sans changement d’état : aucune révocation', async () => {
      prisma.user.findUnique.mockResolvedValue(member);
      await service.patchUser('ws-1', 'u-1', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Ada L.' }],
      } as never);
      expect(prisma.invitation.findMany).not.toHaveBeenCalled();
      expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    });

    it('aucune invitation en attente : aucune écriture ni événement', async () => {
      prisma.user.findUnique.mockResolvedValue(member);
      await service.deleteUser('ws-1', 'u-1');
      expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
      expect(firestoreSync.enqueue).not.toHaveBeenCalled();
    });
  });

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

    // S11 : le domaine de l'e-mail doit être celui, vérifié, du workspace
    const verifiedDomain = (domain: string) =>
      prisma.sSOConfiguration.findUnique.mockResolvedValue({
        domain,
        verifiedDomain: domain,
        domainVerifiedAt: new Date(),
      });
    const writesTo = (field: string) =>
      prisma.user.update.mock.calls.some(([args]) => args?.data && field in args.data) ||
      prisma.user.updateMany.mock.calls.some(([args]) => args?.data && field in args.data);

    it('POST avec l’e-mail d’un utilisateur existant : 409, aucune membership créée', async () => {
      verifiedDomain('corp.com');
      prisma.user.findUnique.mockResolvedValue(victim({ memberships: [] }));

      await expect(
        service.createUser('ws-attaquant', { userName: 'victime@corp.com' }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.membership.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('S10-h : workspace dont la revendication du domaine n’est pas prouvée (verifiedDomain absent) : 403, aucun compte', async () => {
      prisma.sSOConfiguration.findUnique.mockResolvedValue({
        domain: 'corp.com',
        verifiedDomain: null,
        domainVerifiedAt: new Date(),
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createUser('ws-2', { userName: 'nouveau@corp.com' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('POST d’un nouvel utilisateur : rattaché au workspace provisionneur, jamais suspendu globalement', async () => {
      verifiedDomain('corp.com');
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
      // Flux temps réel coupé pour la personne retirée (S16)
      expect(realtime.refreshUserRooms).toHaveBeenCalledWith('u-victim');
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

    it('N3 : PATCH displayName de plus de 191 caractères ou non textuel : 400 invalidValue, aucune écriture', async () => {
      prisma.user.findUnique.mockResolvedValue(
        victim({ id: 'u-own', provisionedByWorkspaceId: 'ws-1' }),
      );
      const patch = (operation: Record<string, unknown>) =>
        service.patchUser('ws-1', 'u-own', {
          schemas: [],
          Operations: [operation as never],
        });

      for (const value of ['x'.repeat(192), ['a', 'b'], 42, { a: 1 }]) {
        await expect(patch({ op: 'replace', path: 'displayName', value })).rejects.toMatchObject({
          response: { scimType: 'invalidValue', status: '400' },
        });
      }
      await expect(
        patch({ op: 'replace', value: { displayName: 'x'.repeat(192) } }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        patch({ op: 'replace', path: 'userName', value: 'u'.repeat(192) }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('N3 : PATCH displayName de 191 caractères accepté ; un remove sans valeur n’est pas refusé (comportement historique)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        victim({ id: 'u-own', provisionedByWorkspaceId: 'ws-1' }),
      );
      prisma.user.update.mockImplementation(async ({ data }) => ({ ...victim(), ...data }));

      await service.patchUser('ws-1', 'u-own', {
        schemas: [],
        Operations: [{ op: 'replace', path: 'displayName', value: 'é'.repeat(191) }],
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'é'.repeat(191) } }),
      );
      await expect(
        service.patchUser('ws-1', 'u-own', {
          schemas: [],
          Operations: [{ op: 'remove', path: 'displayName' }],
        }),
      ).resolves.toBeDefined();
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
