import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceRole, InvitationStatus, ProjectRole } from '@prisma/client';
import * as crypto from 'crypto';
import { maskEmail } from './mask-email';
import { MailService } from '../mail/mail.service';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly firestoreSync: FirestoreSyncService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async assertWorkspaceRole(
    workspaceId: string,
    userId: string,
    allowedRoles: WorkspaceRole[],
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        workspaceId,
        userId,
        workspace: { deletedAt: null },
      },
    });

    if (!membership) {
      throw new ForbiddenException("Vous n'êtes pas membre de cet espace de travail.");
    }

    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Droits insuffisants dans cet espace de travail.');
    }
  }

  async createInvitation(
    workspaceId: string,
    invitedById: string,
    email: string | null,
    role: WorkspaceRole,
    projectId?: string,
    durationDays = 7,
  ) {
    await this.assertWorkspaceRole(workspaceId, invitedById, ['OWNER', 'ADMIN']);

    if (projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, workspaceId, deletedAt: null },
      });
      if (!project) {
        throw new NotFoundException("Le projet spécifié n'existe pas dans ce workspace.");
      }
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const invitation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invitation.create({
        data: {
          email: email || null,
          tokenHash,
          role,
          workspaceId,
          projectId: projectId || null,
          invitedById,
          expiresAt,
        },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'invitation',
        entityId: created.id,
        workspaceId,
        operation: 'upsert',
        payload: this.invitationSyncPayload(created),
      });
      return created;
    });

    if (email) {
      // Récupérer le nom du workspace et de l'invitant pour l'email
      Promise.all([
        this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { name: true },
        }),
        this.prisma.user.findUnique({
          where: { id: invitedById },
          select: { name: true, email: true },
        }),
      ])
        .then(([workspace, invitedByUser]) => {
          this.mailService.sendInvitationEmail(
            email,
            workspace?.name || 'Planner Pro',
            invitedByUser?.name || invitedByUser?.email || 'Un collaborateur',
            rawToken,
            role,
          );
        })
        .catch((err) => {
          console.error(
            "Erreur lors de la récupération des détails d'invitation pour email :",
            err,
          );
        });
    }

    return {
      invitation,
      rawToken,
    };
  }

  async listInvitations(workspaceId: string, userId: string) {
    await this.assertWorkspaceRole(workspaceId, userId, ['OWNER', 'ADMIN']);

    return this.prisma.invitation.findMany({
      where: {
        workspaceId,
        status: InvitationStatus.PENDING,
        expiresAt: { gte: new Date() },
      },
      include: {
        invitedBy: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvitation(invitationId: string, userId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation introuvable.');
    }

    await this.assertWorkspaceRole(invitation.workspaceId, userId, ['OWNER', 'ADMIN']);

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException("Cette invitation n'est plus active.");
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.invitation.update({
        where: { id: invitationId },
        data: { status: InvitationStatus.REVOKED },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'invitation',
        entityId: updated.id,
        workspaceId: invitation.workspaceId,
        operation: 'upsert',
        payload: this.invitationSyncPayload(updated),
      });
      return updated;
    });
  }

  async checkInvitation(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        workspace: { select: { name: true } },
        invitedBy: { select: { name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    if (!invitation || invitation.status !== 'PENDING' || new Date() > invitation.expiresAt) {
      throw new NotFoundException("Lien d'invitation invalide, expiré ou révoqué.");
    }

    return {
      workspaceName: invitation.workspace.name,
      // Route publique : ni l'adresse de l'invité ni celle de l'invitant en clair (S27)
      invitedByName: invitation.invitedBy?.name || 'Un collaborateur',
      role: invitation.role,
      projectName: invitation.project?.name || null,
      projectId: invitation.projectId || null,
      email: invitation.email ? maskEmail(invitation.email) : null,
    };
  }

  async validateAndAcceptInvitation(rawToken: string, loggedUser: { id: string; email: string }) {
    const tokenHash = this.hashToken(rawToken);

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
    });

    if (!invitation) {
      throw new BadRequestException("Lien d'invitation invalide.");
    }

    if (invitation.status === InvitationStatus.REVOKED) {
      throw new BadRequestException("Cette invitation a été révoquée par l'administrateur.");
    }
    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException('Cette invitation a déjà été acceptée.');
    }
    if (new Date() > invitation.expiresAt) {
      await this.prisma.$transaction(async (tx) => {
        const expired = await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: InvitationStatus.EXPIRED },
        });
        await this.firestoreSync.enqueue(tx, {
          entityType: 'invitation',
          entityId: expired.id,
          workspaceId: invitation.workspaceId,
          operation: 'upsert',
          payload: this.invitationSyncPayload(expired),
        });
      });
      throw new BadRequestException("Ce lien d'invitation a expiré.");
    }

    const existingMembership = await this.prisma.membership.findFirst({
      where: {
        workspaceId: invitation.workspaceId,
        userId: loggedUser.id,
      },
    });

    if (existingMembership) {
      await this.prisma.$transaction(async (tx) => {
        if (invitation.projectId) {
          const projectRole =
            invitation.role === 'VIEWER'
              ? ProjectRole.CLIENT
              : invitation.role === 'ADMIN' || invitation.role === 'OWNER'
                ? ProjectRole.MANAGER
                : ProjectRole.CONTRIBUTOR;

          await tx.projectMembership.upsert({
            where: {
              projectId_userId: {
                projectId: invitation.projectId,
                userId: loggedUser.id,
              },
            },
            create: {
              projectId: invitation.projectId,
              userId: loggedUser.id,
              role: projectRole,
            },
            update: {
              role: projectRole,
            },
          });
        }

        const accepted = await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
        });
        await this.firestoreSync.enqueue(tx, {
          entityType: 'invitation',
          entityId: accepted.id,
          workspaceId: invitation.workspaceId,
          operation: 'upsert',
          payload: this.invitationSyncPayload(accepted),
        });
      });
      return {
        workspaceId: invitation.workspaceId,
        projectId: invitation.projectId || undefined,
        message: invitation.projectId
          ? 'Félicitations, vous avez rejoint le projet !'
          : 'Vous êtes déjà membre de cet espace de travail.',
      };
    }

    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: loggedUser.id,
          role: invitation.role,
        },
      });

      if (invitation.projectId) {
        const projectRole =
          invitation.role === 'VIEWER'
            ? ProjectRole.CLIENT
            : invitation.role === 'ADMIN' || invitation.role === 'OWNER'
              ? ProjectRole.MANAGER
              : ProjectRole.CONTRIBUTOR;

        await tx.projectMembership.upsert({
          where: {
            projectId_userId: {
              projectId: invitation.projectId,
              userId: loggedUser.id,
            },
          },
          create: {
            projectId: invitation.projectId,
            userId: loggedUser.id,
            role: projectRole,
          },
          update: {
            role: projectRole,
          },
        });
      }

      const accepted = await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'membership',
        entityId: membership.id,
        workspaceId: invitation.workspaceId,
        operation: 'upsert',
        payload: {
          id: membership.id,
          workspaceId: membership.workspaceId,
          userId: membership.userId,
          role: membership.role,
          createdAt: membership.createdAt
            ? new Date(membership.createdAt).toISOString()
            : new Date().toISOString(),
        },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'invitation',
        entityId: accepted.id,
        workspaceId: invitation.workspaceId,
        operation: 'upsert',
        payload: this.invitationSyncPayload(accepted),
      });
    });

    return {
      workspaceId: invitation.workspaceId,
      projectId: invitation.projectId || undefined,
      message: invitation.projectId
        ? 'Félicitations, vous avez rejoint le projet et son espace de travail !'
        : "Félicitations, vous avez rejoint l'espace de travail !",
    };
  }

  private invitationSyncPayload(invitation: {
    id: string;
    email: string | null;
    role: string;
    workspaceId: string;
    projectId: string | null;
    invitedById: string;
    status: string;
    expiresAt: Date | string;
    acceptedAt?: Date | string | null;
    createdAt?: Date | string | null;
  }) {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      workspaceId: invitation.workspaceId,
      projectId: invitation.projectId,
      invitedById: invitation.invitedById,
      status: invitation.status,
      expiresAt: new Date(invitation.expiresAt).toISOString(),
      acceptedAt: invitation.acceptedAt ? new Date(invitation.acceptedAt).toISOString() : null,
      createdAt: invitation.createdAt
        ? new Date(invitation.createdAt).toISOString()
        : new Date().toISOString(),
    };
  }
}
