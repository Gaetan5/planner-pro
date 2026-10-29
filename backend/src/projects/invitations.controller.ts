import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Public } from '../auth/public.decorator';
import { CreateInvitationDto } from './dto/create-invitation.dto';

interface AuthenticatedRequest {
  user: {
    id: string;
    email: string;
    name?: string;
  };
}

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /**
   * Crée une invitation pour rejoindre un workspace.
   */
  @Post('workspaces/:workspaceId/invitations')
  createInvitation(
    @Req() req: AuthenticatedRequest,
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
  listInvitations(@Req() req: AuthenticatedRequest, @Param('workspaceId') workspaceId: string) {
    return this.invitationsService.listInvitations(workspaceId, req.user.id);
  }

  /**
   * Révoque une invitation active.
   */
  @Delete('invitations/:invitationId')
  revokeInvitation(@Req() req: AuthenticatedRequest, @Param('invitationId') invitationId: string) {
    return this.invitationsService.revokeInvitation(invitationId, req.user.id);
  }

  /**
   * Endpoint public pour vérifier un token d'invitation (affichage de l'écran d'accueil).
   */
  @Public()
  @Get('invitations/check/:token')
  checkInvitation(@Param('token') token: string) {
    return this.invitationsService.checkInvitation(token);
  }

  /**
   * Accepte une invitation pour l'utilisateur actuellement connecté.
   */
  @Post('invitations/accept/:token')
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@Req() req: AuthenticatedRequest, @Param('token') token: string) {
    return this.invitationsService.validateAndAcceptInvitation(token, req.user);
  }
}
