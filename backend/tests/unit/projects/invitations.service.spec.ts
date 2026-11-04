import { RealtimeService } from '../../../src/realtime/realtime.service';
import { PolicyService } from '../../../src/authz/policy.service';
import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsService } from '../../../src/projects/invitations.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MailService } from '../../../src/mail/mail.service';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';
import { WorkspaceRole, InvitationStatus } from '@prisma/client';
import * as crypto from 'crypto';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: PrismaService;

  const mockMailService = {
    sendInvitationEmail: jest.fn().mockResolvedValue(true),
    sendMentionEmail: jest.fn().mockResolvedValue(true),
  };

  const mockPrisma = {
    membership: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
    invitation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Test Workspace' }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Admin User', email: 'admin@test.com' }),
    },
    projectMembership: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockRealtime = { refreshUserRooms: jest.fn() };

  const mockFirestoreSync = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyService,
        InvitationsService,
        { provide: RealtimeService, useValue: mockRealtime },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
        { provide: FirestoreSyncService, useValue: mockFirestoreSync },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('createInvitation', () => {
    const workspaceId = 'workspace-123';
    const invitedById = 'user-admin';

    it("devrait rejeter si l'invitant n'est pas membre admin ou owner du workspace", async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(null);

      await expect(
        service.createInvitation(workspaceId, invitedById, 'test@test.com', WorkspaceRole.MEMBER),
      ).rejects.toThrow(/Workspace not found or unauthorized/);
    });

    it("devrait rejeter si l'invitant a un rôle inférieur à ADMIN (ex: MEMBER)", async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({
        role: WorkspaceRole.MEMBER,
      });

      await expect(
        service.createInvitation(workspaceId, invitedById, 'test@test.com', WorkspaceRole.MEMBER),
      ).rejects.toThrow(/insufficient workspace permissions/);
    });

    it('devrait créer une invitation avec succès et retourner le token en clair', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({
        role: WorkspaceRole.ADMIN,
      });

      mockPrisma.invitation.create.mockResolvedValue({
        id: 'invite-id',
        email: 'guest@guest.com',
        role: WorkspaceRole.MEMBER,
        workspaceId,
        invitedById,
        projectId: null,
        status: InvitationStatus.PENDING,
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      const result = await service.createInvitation(
        workspaceId,
        invitedById,
        'guest@guest.com',
        WorkspaceRole.MEMBER,
      );

      expect(result.rawToken).toBeDefined();
      expect(result.rawToken.length).toBe(64);
      expect(mockPrisma.invitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'guest@guest.com',
          role: WorkspaceRole.MEMBER,
          workspaceId,
          invitedById,
        }),
      });
    });
  });

  describe('revokeInvitation', () => {
    const invitationId = 'invite-123';
    const userId = 'user-owner';

    it("devrait rejeter si l'invitation n'existe pas", async () => {
      mockPrisma.invitation.findUnique.mockResolvedValue(null);

      await expect(service.revokeInvitation(invitationId, userId)).rejects.toThrow(
        /Invitation introuvable/,
      );
    });

    it("devrait changer le statut de l'invitation à REVOKED si l'utilisateur a les droits", async () => {
      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        workspaceId: 'workspace-123',
        status: InvitationStatus.PENDING,
      });

      mockPrisma.membership.findFirst.mockResolvedValue({
        role: WorkspaceRole.OWNER,
      });

      mockPrisma.invitation.update.mockResolvedValue({
        id: invitationId,
        workspaceId: 'workspace-123',
        status: InvitationStatus.REVOKED,
        role: WorkspaceRole.MEMBER,
        invitedById: 'user-admin',
        projectId: null,
        email: 'guest@guest.com',
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      const result = await service.revokeInvitation(invitationId, userId);

      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: invitationId },
        data: { status: InvitationStatus.REVOKED },
      });
      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'invitation',
          entityId: invitationId,
          workspaceId: 'workspace-123',
          operation: 'upsert',
        }),
      );
    });
  });

  describe('validateAndAcceptInvitation', () => {
    const rawToken = 'my-secret-invitation-token';
    const loggedUser = { id: 'new-user-456', email: 'guest@guest.com' };

    it("devrait rejeter si le token n'est pas trouvé en base", async () => {
      mockPrisma.invitation.findUnique.mockResolvedValue(null);

      await expect(service.validateAndAcceptInvitation(rawToken, loggedUser)).rejects.toThrow(
        /Lien d'invitation invalide/,
      );
    });

    it("devrait rejeter si l'invitation est expirée", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: 'invite-id',
        workspaceId: 'workspace-123',
        status: InvitationStatus.PENDING,
        expiresAt: pastDate,
      });

      mockPrisma.invitation.update.mockResolvedValue({
        id: 'invite-id',
        workspaceId: 'workspace-123',
        status: InvitationStatus.EXPIRED,
        role: WorkspaceRole.MEMBER,
        invitedById: 'user-admin',
        projectId: null,
        email: 'guest@guest.com',
        expiresAt: pastDate,
        createdAt: new Date(),
      });

      await expect(service.validateAndAcceptInvitation(rawToken, loggedUser)).rejects.toThrow(
        /Ce lien d'invitation a expiré/,
      );

      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: 'invite-id' },
        data: { status: InvitationStatus.EXPIRED },
      });
      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'invitation',
          entityId: 'invite-id',
          operation: 'upsert',
        }),
      );
    });

    // L'invitant est OWNER/ADMIN (contrôlé à l'acceptation) ; l'utilisateur connecté n'est pas membre
    const membershipLookup = (existing: unknown) =>
      mockPrisma.membership.findFirst.mockImplementation(
        async ({ where }: { where: { userId: string } }) =>
          where.userId === 'user-admin' ? { role: WorkspaceRole.ADMIN } : existing,
      );

    it("devrait accepter l'invitation et créer un membership en BDD", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const accepted = {
        id: 'invite-id',
        workspaceId: 'workspace-123',
        status: InvitationStatus.ACCEPTED,
        role: WorkspaceRole.MEMBER,
        invitedById: 'user-admin',
        projectId: null,
        email: 'guest@guest.com',
        expiresAt: futureDate,
        acceptedAt: new Date(),
        createdAt: new Date(),
      };

      mockPrisma.invitation.findUnique.mockResolvedValue({
        ...accepted,
        status: InvitationStatus.PENDING,
        acceptedAt: null,
      });
      membershipLookup(null);
      mockPrisma.invitation.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.invitation.findUniqueOrThrow.mockResolvedValue(accepted);
      mockPrisma.membership.create.mockResolvedValue({
        id: 'membership-1',
        workspaceId: 'workspace-123',
        userId: loggedUser.id,
        role: WorkspaceRole.MEMBER,
        createdAt: new Date(),
      });

      const result = await service.validateAndAcceptInvitation(rawToken, loggedUser);

      expect(result.message).toContain('Félicitations');
      expect(mockPrisma.membership.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'workspace-123',
          userId: loggedUser.id,
          role: WorkspaceRole.MEMBER,
        },
      });
      expect(mockPrisma.invitation.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'invite-id',
          status: InvitationStatus.PENDING,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: expect.any(Date) },
      });
      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'membership',
          entityId: 'membership-1',
          operation: 'upsert',
        }),
      );
      expect(mockFirestoreSync.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'invitation',
          entityId: 'invite-id',
          operation: 'upsert',
        }),
      );
    });

    it('membre existant invité sur un projet : rôle de projet attribué et salons recalculés (S16-b)', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const invitation = {
        id: 'invite-id',
        workspaceId: 'workspace-123',
        projectId: 'project-9',
        projectRole: 'CONTRIBUTOR',
        role: WorkspaceRole.VIEWER,
        invitedById: 'user-admin',
        status: InvitationStatus.PENDING,
        email: 'guest@guest.com',
        expiresAt: futureDate,
        createdAt: new Date(),
      };
      mockPrisma.invitation.findUnique.mockResolvedValue(invitation);
      membershipLookup({
        id: 'membership-1',
        workspaceId: 'workspace-123',
        userId: loggedUser.id,
        role: WorkspaceRole.MEMBER,
      });
      mockPrisma.invitation.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.invitation.findUniqueOrThrow.mockResolvedValue({
        ...invitation,
        status: InvitationStatus.ACCEPTED,
      });
      mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-9' });
      mockPrisma.projectMembership.findUnique.mockResolvedValue(null);

      const result = await service.validateAndAcceptInvitation(rawToken, loggedUser);

      expect(result.projectId).toBe('project-9');
      expect(mockPrisma.membership.create).not.toHaveBeenCalled();
      expect(mockPrisma.projectMembership.create).toHaveBeenCalledWith({
        data: { projectId: 'project-9', userId: loggedUser.id, role: 'CONTRIBUTOR' },
      });
      expect(mockRealtime.refreshUserRooms).toHaveBeenCalledWith(loggedUser.id);
    });
  });
});
