import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceRole, InvitationStatus } from '@prisma/client';
import * as crypto from 'crypto';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: PrismaService;

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
      update: jest.fn(),
    },
    $transaction: jest.fn((promises) => Promise.all(promises)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('createInvitation', () => {
    const workspaceId = 'workspace-123';
    const invitedById = 'user-admin';

    it('devrait rejeter si l\'invitant n\'est pas membre admin ou owner du workspace', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(null);

      await expect(
        service.createInvitation(workspaceId, invitedById, 'test@test.com', WorkspaceRole.MEMBER)
      ).rejects.toThrow(/Vous n'êtes pas membre/);
    });

    it('devrait rejeter si l\'invitant a un rôle inférieur à ADMIN (ex: MEMBER)', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({
        role: WorkspaceRole.MEMBER,
      });

      await expect(
        service.createInvitation(workspaceId, invitedById, 'test@test.com', WorkspaceRole.MEMBER)
      ).rejects.toThrow(/Droits insuffisants/);
    });

    it('devrait créer une invitation avec succès et retourner le token en clair', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({
        role: WorkspaceRole.ADMIN,
      });

      mockPrisma.invitation.create.mockResolvedValue({
        id: 'invite-id',
        email: 'guest@guest.com',
        role: WorkspaceRole.MEMBER,
      });

      const result = await service.createInvitation(
        workspaceId,
        invitedById,
        'guest@guest.com',
        WorkspaceRole.MEMBER
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

    it('devrait rejeter si l\'invitation n\'existe pas', async () => {
      mockPrisma.invitation.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeInvitation(invitationId, userId)
      ).rejects.toThrow(/Invitation introuvable/);
    });

    it('devrait changer le statut de l\'invitation à REVOKED si l\'utilisateur a les droits', async () => {
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
        status: InvitationStatus.REVOKED,
      });

      const result = await service.revokeInvitation(invitationId, userId);

      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: invitationId },
        data: { status: InvitationStatus.REVOKED },
      });
    });
  });

  describe('validateAndAcceptInvitation', () => {
    const rawToken = 'my-secret-invitation-token';
    const loggedUser = { id: 'new-user-456', email: 'guest@guest.com' };

    it('devrait rejeter si le token n\'est pas trouvé en base', async () => {
      mockPrisma.invitation.findUnique.mockResolvedValue(null);

      await expect(
        service.validateAndAcceptInvitation(rawToken, loggedUser)
      ).rejects.toThrow(/Lien d'invitation invalide/);
    });

    it('devrait rejeter si l\'invitation est expirée', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: 'invite-id',
        status: InvitationStatus.PENDING,
        expiresAt: pastDate,
      });

      await expect(
        service.validateAndAcceptInvitation(rawToken, loggedUser)
      ).rejects.toThrow(/Ce lien d'invitation a expiré/);

      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: 'invite-id' },
        data: { status: InvitationStatus.EXPIRED },
      });
    });

    it('devrait accepter l\'invitation et créer un membership en BDD', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: 'invite-id',
        workspaceId: 'workspace-123',
        role: WorkspaceRole.MEMBER,
        status: InvitationStatus.PENDING,
        expiresAt: futureDate,
      });

      mockPrisma.membership.findFirst.mockResolvedValue(null);

      const result = await service.validateAndAcceptInvitation(rawToken, loggedUser);

      expect(result.message).toContain("Félicitations");
      expect(mockPrisma.membership.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'workspace-123',
          userId: loggedUser.id,
          role: WorkspaceRole.MEMBER,
        },
      });
      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: 'invite-id' },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: expect.any(Date) },
      });
    });
  });
});
