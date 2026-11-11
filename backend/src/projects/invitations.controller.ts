import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InvitationsService } from './invitations.service';
import { UuidPipe } from '../common/uuid.pipe';
import { Public } from '../auth/public.decorator';
import { ForbiddenInImpersonation } from '../auth/forbidden-in-impersonation.decorator';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationTokenDto } from './dto/invitation-token.dto';

interface AuthenticatedRequest {
  user: {
    id: string;
    email: string;
    name?: string;
  };
}

@Controller('projects')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /**
   * Crée une invitation pour rejoindre un workspace.
   */
  @Post('workspaces/:workspaceId/invitations')
  @ForbiddenInImpersonation()
  createInvitation(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', UuidPipe) workspaceId: string,
    @Body() body: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(
      workspaceId,
      req.user.id,
      body.email || null,
      body.role,
      body.projectId,
      body.durationDays,
      body.projectRole,
    );
  }

  /**
   * Liste les invitations actives pour un workspace.
   */
  @Get('workspaces/:workspaceId/invitations')
  listInvitations(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', UuidPipe) workspaceId: string,
  ) {
    return this.invitationsService.listInvitations(workspaceId, req.user.id);
  }

  /**
   * Révoque une invitation active.
   */
  @Delete('invitations/:invitationId')
  revokeInvitation(
    @Req() req: AuthenticatedRequest,
    @Param('invitationId', UuidPipe) invitationId: string,
  ) {
    return this.invitationsService.revokeInvitation(invitationId, req.user.id);
  }

  /**
   * Endpoint public pour vérifier un token d'invitation (affichage de l'écran d'accueil). Le jeton
   * est dans le corps, jamais dans le chemin (S27).
   */
  @Public()
  @Post('invitations/check')
  // Route anonyme : plus basse que le défaut global (60/min), le jeton (256 bits) n'étant de toute
  // façon pas énumérable (S24, r35)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  checkInvitation(@Body() body: InvitationTokenDto) {
    return this.invitationsService.checkInvitation(body.token);
  }

  /**
   * Accepte une invitation pour l'utilisateur actuellement connecté. Jeton dans le corps (S27).
   */
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@Req() req: AuthenticatedRequest, @Body() body: InvitationTokenDto) {
    return this.invitationsService.validateAndAcceptInvitation(body.token, req.user);
  }
}
