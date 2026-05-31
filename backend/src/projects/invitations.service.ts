import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceRole, InvitationStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async assertWorkspaceRole(workspaceId: string, userId: string, allowedRoles: WorkspaceRole[]) {
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
      throw new ForbiddenException("Droits insuffisants dans cet espace de travail.");
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

    const invitation = await this.prisma.invitation.create({
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
      ]).then(([workspace, invitedByUser]) => {
        this.mailService.sendInvitationEmail(
          email,
          workspace?.name || 'Planner Pro',
          invitedByUser?.name || invitedByUser?.email || 'Un collaborateur',
          rawToken,
          role,
        );
      }).catch(err => {
        console.error("Erreur lors de la récupération des détails d'invitation pour email :", err);
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
      throw new NotFoundException("Invitation introuvable.");
    }

    await this.assertWorkspaceRole(invitation.workspaceId, userId, ['OWNER', 'ADMIN']);

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException("Cette invitation n'est plus active.");
    }

    return this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED },
    });
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
      throw new BadRequestException("Cette invitation a déjà été acceptée.");
    }
    if (new Date() > invitation.expiresAt) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
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
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });
      return {
        workspaceId: invitation.workspaceId,
        message: "Vous êtes déjà membre de cet espace de travail.",
      };
    }

    await this.prisma.$transaction([
      this.prisma.membership.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: loggedUser.id,
          role: invitation.role,
        },
      }),
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
      }),
    ]);

    return {
      workspaceId: invitation.workspaceId,
      message: "Félicitations, vous avez rejoint l'espace de travail !",
    };
  }
}
