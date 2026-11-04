import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WorkspaceRole, InvitationStatus, ProjectRole } from '@prisma/client';
import * as crypto from 'crypto';
import { maskEmail } from './mask-email';
import { MailService } from '../mail/mail.service';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';
import { invitationSyncPayload } from './invitation-sync-payload';

/** Durée maximale d'une invitation (S17). */
export const MAX_INVITATION_DURATION_DAYS = 30;

const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};
const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  MANAGER: 4,
  CONTRIBUTOR: 3,
  COMMENTER: 2,
  CLIENT: 1,
};
const INVALID_INVITATION = "Cette invitation n'est plus valide.";

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly firestoreSync: FirestoreSyncService,
    private readonly policy: PolicyService,
    private readonly realtime: RealtimeService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Crée une invitation (S17). Règles : OWNER jamais invitable ; rôle invité <= rôle de l'invitant ;
   * une invitation à un projet donne le rôle VIEWER sur le workspace (aucune visibilité implicite
   * des projets, P4) et un rôle de projet choisi explicitement (`projectRole`, CLIENT par défaut) ;
   * un lien anonyme (sans e-mail) est réservé à un projet, sans MANAGER, à usage unique.
   */
  async createInvitation(
    workspaceId: string,
    invitedById: string,
    emailInput: string | null,
    requestedRole: WorkspaceRole | undefined,
    projectId?: string,
    durationDays = 7,
    projectRoleInput?: ProjectRole,
  ) {
    const inviter = await this.policy.assertWorkspaceRoles(workspaceId, invitedById, [
      'OWNER',
      'ADMIN',
    ]);

    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1 ||
      durationDays > MAX_INVITATION_DURATION_DAYS
    ) {
      throw new BadRequestException(
        `La durée d'une invitation est comprise entre 1 et ${MAX_INVITATION_DURATION_DAYS} jours.`,
      );
    }

    const email = emailInput ? emailInput.trim().toLowerCase() : null;
    // Invitation à un projet : l'invité n'est que VIEWER du workspace ; le rôle demandé est ignoré
    const role: WorkspaceRole = projectId ? WorkspaceRole.VIEWER : (requestedRole as WorkspaceRole);
    if (!projectId && !requestedRole) {
      throw new BadRequestException('Le rôle spécifié est invalide.');
    }
    if (role === WorkspaceRole.OWNER) {
      throw new ForbiddenException(
        'Le rôle OWNER ne peut pas être attribué par invitation (transfert de propriété dédié).',
      );
    }
    if (WORKSPACE_ROLE_RANK[role] > WORKSPACE_ROLE_RANK[inviter.role]) {
      throw new ForbiddenException('Vous ne pouvez pas inviter avec un rôle supérieur au vôtre.');
    }

    const projectRole = projectId ? (projectRoleInput ?? ProjectRole.CLIENT) : null;
    if (!email) {
      // Lien anonyme : n'importe quel détenteur du lien devient membre, donc le moins de droits possible
      if (!projectId) {
        throw new BadRequestException(
          'Un lien sans adresse e-mail ne peut inviter que sur un projet.',
        );
      }
      if (projectRole === ProjectRole.MANAGER) {
        throw new BadRequestException(
          'Un lien sans adresse e-mail ne peut pas donner le rôle MANAGER.',
        );
      }
    }

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
          email,
          tokenHash,
          role,
          workspaceId,
          projectId: projectId || null,
          projectRole,
          invitedById,
          expiresAt,
        },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'invitation',
        entityId: created.id,
        workspaceId,
        operation: 'upsert',
        payload: invitationSyncPayload(created),
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
    await this.policy.assertWorkspaceRoles(workspaceId, userId, ['OWNER', 'ADMIN']);

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

    await this.policy.assertWorkspaceRoles(invitation.workspaceId, userId, ['OWNER', 'ADMIN']);

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
        payload: invitationSyncPayload(updated),
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
          payload: invitationSyncPayload(expired),
        });
      });
      throw new BadRequestException("Ce lien d'invitation a expiré.");
    }

    // Invitation nominative : seul le titulaire de l'adresse peut l'accepter (S17). Un lien
    // transféré, journalisé ou intercepté ne suffit pas.
    if (
      invitation.email &&
      invitation.email.trim().toLowerCase() !== (loggedUser.email ?? '').trim().toLowerCase()
    ) {
      throw new ForbiddenException(
        'Cette invitation est destinée à une autre adresse e-mail. Connectez-vous avec le compte invité.',
      );
    }

    // OWNER n'est jamais invitable (lignes antérieures comprises)
    if (invitation.role === WorkspaceRole.OWNER) {
      throw new ForbiddenException(INVALID_INVITATION);
    }
    // L'invitant doit toujours être OWNER/ADMIN du workspace, avec un rôle au moins égal à celui
    // proposé : un administrateur déprovisionné ne laisse pas de liens actifs derrière lui.
    const inviter = await this.prisma.membership.findFirst({
      where: {
        workspaceId: invitation.workspaceId,
        userId: invitation.invitedById,
        role: { in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN] },
        workspace: { deletedAt: null },
      },
    });
    if (!inviter || WORKSPACE_ROLE_RANK[invitation.role] > WORKSPACE_ROLE_RANK[inviter.role]) {
      throw new BadRequestException(INVALID_INVITATION);
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Acceptation atomique : une seule requête concurrente peut consommer l'invitation
      const claimed = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: new Date() },
        },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(INVALID_INVITATION);
      }

      const existingMembership = await tx.membership.findFirst({
        where: { workspaceId: invitation.workspaceId, userId: loggedUser.id },
      });

      let createdMembership: {
        id: string;
        workspaceId: string;
        userId: string;
        role: string;
        createdAt?: Date | null;
      } | null = null;
      if (!existingMembership) {
        // Invitation à un projet : VIEWER du workspace, jamais le rôle de l'invitation (S17)
        createdMembership = await tx.membership.create({
          data: {
            workspaceId: invitation.workspaceId,
            userId: loggedUser.id,
            role: invitation.projectId ? WorkspaceRole.VIEWER : invitation.role,
          },
        });
      }

      if (invitation.projectId) {
        const project = await tx.project.findFirst({
          where: {
            id: invitation.projectId,
            workspaceId: invitation.workspaceId,
            deletedAt: null,
          },
        });
        if (!project) {
          throw new BadRequestException(INVALID_INVITATION);
        }
        const projectRole = invitation.projectRole ?? ProjectRole.CLIENT;
        const current = await tx.projectMembership.findUnique({
          where: {
            projectId_userId: { projectId: invitation.projectId, userId: loggedUser.id },
          },
        });
        if (!current) {
          await tx.projectMembership.create({
            data: { projectId: invitation.projectId, userId: loggedUser.id, role: projectRole },
          });
        } else if (PROJECT_ROLE_RANK[projectRole] > PROJECT_ROLE_RANK[current.role]) {
          // Jamais de rétrogradation par invitation
          await tx.projectMembership.update({
            where: {
              projectId_userId: { projectId: invitation.projectId, userId: loggedUser.id },
            },
            data: { role: projectRole },
          });
        }
      }

      const accepted = await tx.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      if (createdMembership) {
        await this.firestoreSync.enqueue(tx, {
          entityType: 'membership',
          entityId: createdMembership.id,
          workspaceId: invitation.workspaceId,
          operation: 'upsert',
          payload: {
            id: createdMembership.id,
            workspaceId: createdMembership.workspaceId,
            userId: createdMembership.userId,
            role: createdMembership.role,
            createdAt: createdMembership.createdAt
              ? new Date(createdMembership.createdAt).toISOString()
              : new Date().toISOString(),
          },
        });
      }
      await this.firestoreSync.enqueue(tx, {
        entityType: 'invitation',
        entityId: accepted.id,
        workspaceId: invitation.workspaceId,
        operation: 'upsert',
        payload: invitationSyncPayload(accepted),
      });
      return { alreadyMember: Boolean(existingMembership) };
    });

    // Nouveaux droits : les sockets déjà ouvertes rejoignent les bons salons (S16)
    await this.realtime.refreshUserRooms(loggedUser.id);

    return {
      workspaceId: invitation.workspaceId,
      projectId: invitation.projectId || undefined,
      message: invitation.projectId
        ? outcome.alreadyMember
          ? 'Félicitations, vous avez rejoint le projet !'
          : 'Félicitations, vous avez rejoint le projet et son espace de travail !'
        : outcome.alreadyMember
          ? 'Vous êtes déjà membre de cet espace de travail.'
          : "Félicitations, vous avez rejoint l'espace de travail !",
    };
  }
}
