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
import { UuidPipe } from '../../common/uuid.pipe';
import { Throttle } from '@nestjs/throttler';
import { SsoService, SSO_FLOW_TTL_SECONDS } from './sso.service';
import { DiscoverSsoDto, SsoAuthorizeQueryDto, SsoCallbackDto, ConfigureSsoDto } from './sso.dto';
import { Public } from '../public.decorator';
import { ForbiddenInImpersonation } from '../forbidden-in-impersonation.decorator';
import { respondWithLogin, userAgentOf } from '../login-response';
import { FeatureFlagGuard, RequireFeature } from '../../config/feature-flag.guard';

/** Cookie qui lie le `state` SSO au navigateur ayant démarré le flux (S10). */
const SSO_FLOW_COOKIE = 'sso_flow';
const SSO_FLOW_COOKIE_PATH = '/auth/sso';

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
   * Démarre le flux : renvoie l'URL de l'IdP (state, nonce et PKCE générés côté serveur) et lie
   * le `state` au navigateur par un cookie httpOnly (anti login CSRF, S10).
   */
  @Public()
  @Get('auth/sso/authorize')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getAuthorizeUrl(
    @Query() query: SsoAuthorizeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { url, state } = await this.ssoService.getAuthorizationUrl(query.domain);
    res.cookie(SSO_FLOW_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: SSO_FLOW_COOKIE_PATH,
      maxAge: SSO_FLOW_TTL_SECONDS * 1000,
    });
    return { url };
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
    const flowCookie = req.cookies?.[SSO_FLOW_COOKIE];
    res.clearCookie(SSO_FLOW_COOKIE, { path: SSO_FLOW_COOKIE_PATH });
    const { workspaceId, ...login } = await this.ssoService.handleCallback(
      dto.code,
      dto.state,
      flowCookie,
      userAgentOf(req),
    );
    return { ...respondWithLogin(res, login), workspaceId };
  }

  /**
   * Récupère la configuration SSO d'un espace de travail
   */
  @Get('workspaces/:workspaceId/sso')
  async getWorkspaceSSO(
    @Param('workspaceId', UuidPipe) workspaceId: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.ssoService.getWorkspaceSSO(workspaceId, req.user.id);
  }

  /**
   * Met à jour ou active la configuration SSO d'un espace de travail
   */
  @Post('workspaces/:workspaceId/sso')
  @ForbiddenInImpersonation()
  async configureWorkspaceSSO(
    @Param('workspaceId', UuidPipe) workspaceId: string,
    @Body() dto: ConfigureSsoDto,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.ssoService.configureWorkspaceSSO(workspaceId, req.user.id, dto);
  }

  /**
   * Vérifie l'enregistrement DNS TXT du domaine (preuve de propriété, S10)
   */
  @Post('workspaces/:workspaceId/sso/verify-domain')
  @ForbiddenInImpersonation()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async verifyDomain(
    @Param('workspaceId', UuidPipe) workspaceId: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.ssoService.verifyDomain(workspaceId, req.user.id);
  }

  /**
   * Supprime la configuration SSO d'un espace de travail
   */
  @Delete('workspaces/:workspaceId/sso')
  @ForbiddenInImpersonation()
  async deleteWorkspaceSSO(
    @Param('workspaceId', UuidPipe) workspaceId: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.ssoService.deleteWorkspaceSSO(workspaceId, req.user.id);
  }
}
