import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req, HttpCode, HttpStatus, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Public } from '../auth/public.decorator';
import { CreateInvitationDto } from './dto/create-invitation.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /**
   * Crée une invitation pour rejoindre un workspace.
   */
  @Post('workspaces/:workspaceId/invitations')
  createInvitation(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(
      workspaceId,
      req.user.id,
      body.email || null,
      body.role,
      body.projectId,
      body.durationDays,
    );
  }

  /**
   * Liste les invitations actives pour un workspace.
   */
  @Get('workspaces/:workspaceId/invitations')
  listInvitations(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    return this.invitationsService.listInvitations(workspaceId, req.user.id);
  }

  /**
   * Révoque une invitation active.
   */
  @Delete('invitations/:invitationId')
  revokeInvitation(@Req() req: any, @Param('invitationId') invitationId: string) {
    return this.invitationsService.revokeInvitation(invitationId, req.user.id);
  }

  /**
   * Endpoint public pour vérifier un token d'invitation (affichage de l'écran d'accueil).
   */
  @Public()
  @Get('invitations/check/:token')
  async checkInvitation(@Param('token') token: string) {
    // Utiliser la validation interne sans appliquer l'adhésion
    // pour extraire les informations publiques d'affichage
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
    
    // Récupérer l'invitation
    const invitation = await (this.invitationsService as any).prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        workspace: { select: { name: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });

    if (!invitation || invitation.status !== 'PENDING' || new Date() > invitation.expiresAt) {
      throw new NotFoundException("Lien d'invitation invalide, expiré ou révoqué.");
    }

    return {
      workspaceName: invitation.workspace.name,
      invitedByName: invitation.invitedBy.name || invitation.invitedBy.email,
      role: invitation.role,
    };
  }

  /**
   * Accepte une invitation pour l'utilisateur actuellement connecté.
   */
  @Post('invitations/accept/:token')
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@Req() req: any, @Param('token') token: string) {
    return this.invitationsService.validateAndAcceptInvitation(token, req.user);
  }
}
