import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { SsoService } from './sso.service';
import { DiscoverSsoDto, SsoCallbackDto, ConfigureSsoDto } from './sso.dto';
import { JwtAuthGuard } from '../jwt.guard';
import { Public } from '../public.decorator';
import { respondWithLogin, userAgentOf } from '../login-response';
import { FeatureFlagGuard, RequireFeature } from '../../config/feature-flag.guard';

interface AuthenticatedUserRequest {
  user: {
    id: string;
    email: string;
    name?: string;
  };
}

@Controller()
@RequireFeature('SSO')
@UseGuards(FeatureFlagGuard)
export class SsoController {
  constructor(private readonly ssoService: SsoService) {}

  /**
   * Endpoint de découverte SSO à partir de l'email professionnel
   */
  @Public()
  @Post('auth/sso/discover')
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  async discover(@Body() dto: DiscoverSsoDto) {
    return this.ssoService.discover(dto.email);
  }

  /**
   * Endpoint d'obtention de l'URL d'autorisation IdP
   */
  @Public()
  @Get('auth/sso/authorize')
  async getAuthorizeUrl(
    @Query('domain') domain: string,
    @Query('redirectUri') redirectUri?: string,
  ) {
    return this.ssoService.getAuthorizationUrl(domain, redirectUri);
  }

  /**
   * Callback SSO après redirection depuis le fournisseur d'identité
   */
  @Public()
  @Post('auth/sso/callback')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async handleCallback(
    @Body() dto: SsoCallbackDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { workspaceId, ...login } = await this.ssoService.handleCallback(
      dto.code,
      dto.domain,
      dto.redirectUri,
      userAgentOf(req),
    );
    return { ...respondWithLogin(res, login), workspaceId };
  }

  /**
   * Récupère la configuration SSO d'un espace de travail
   */
  @UseGuards(JwtAuthGuard)
  @Get('workspaces/:workspaceId/sso')
  async getWorkspaceSSO(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.ssoService.getWorkspaceSSO(workspaceId, req.user.id);
  }

  /**
   * Met à jour ou active la configuration SSO d'un espace de travail
   */
  @UseGuards(JwtAuthGuard)
  @Post('workspaces/:workspaceId/sso')
  async configureWorkspaceSSO(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: ConfigureSsoDto,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.ssoService.configureWorkspaceSSO(workspaceId, req.user.id, dto);
  }

  /**
   * Supprime la configuration SSO d'un espace de travail
   */
  @UseGuards(JwtAuthGuard)
  @Delete('workspaces/:workspaceId/sso')
  async deleteWorkspaceSSO(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.ssoService.deleteWorkspaceSSO(workspaceId, req.user.id);
  }
}
