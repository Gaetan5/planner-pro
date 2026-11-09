import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  HttpCode,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { ForbiddenInImpersonation } from './forbidden-in-impersonation.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { EmailOnlyDto, ResetPasswordDto, VerifyEmailDto } from './dto/password-reset.dto';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { FirebaseLinkDto, GithubLinkDto, IdentityUnlinkDto } from './dto/identity.dto';
import { GithubAuthorizeQueryDto, GithubLoginDto, GithubSyncDto } from './dto/github.dto';
import {
  GITHUB_STATE_COOKIE,
  GITHUB_STATE_COOKIE_PATH,
  GITHUB_STATE_TTL_SECONDS,
  readGithubOAuthPurpose,
} from './github-oauth-state';
import {
  DisableMfaDto,
  SetupMfaDto,
  MfaChallengeDto,
  MfaCodeDto,
  RegenerateRecoveryCodesDto,
} from './dto/mfa.dto';
import { respondWithLogin, userAgentOf } from './login-response';
import { SessionService } from './session.service';
import {
  clearSessionCookies,
  readAccessCookie,
  readRefreshCookie,
  setSessionCookies,
} from './session-cookies';
import { TokenService } from './token.service';

interface AuthenticatedUserRequest {
  user: {
    id: string;
    sid?: string;
    impersonatedBy?: string;
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Démarre l'OAuth GitHub : génère un `state` aléatoire, le pose dans un cookie signé
   * (httpOnly, SameSite=Lax, 10 min) et renvoie l'URL d'autorisation (S9).
   */
  @Public()
  @Get('github/authorize')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  githubAuthorize(
    @Query() query: GithubAuthorizeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { url, cookieValue } = this.authService.buildGithubAuthorizeUrl(query.purpose ?? 'login');
    res.cookie(GITHUB_STATE_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: GITHUB_STATE_COOKIE_PATH,
      maxAge: GITHUB_STATE_TTL_SECONDS * 1000,
    });
    return { url };
  }

  /**
   * Finalité (login, link, repos) de l'autorisation GitHub en cours, lue dans le cookie signé :
   * le frontend s'en sert, au retour de GitHub, pour appeler la bonne route (S9-b).
   */
  @Public()
  @Get('github/pending')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  githubPending(@Req() req: Request) {
    const purpose = readGithubOAuthPurpose(req.cookies?.[GITHUB_STATE_COOKIE]);
    if (!purpose) {
      throw new UnauthorizedException('Aucune autorisation GitHub en cours.');
    }
    return { purpose };
  }

  /**
   * Endpoint de login OAuth GitHub : `state` obligatoire, cookie effacé après usage.
   */
  @Public()
  @Post('github/login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async loginWithGitHub(
    @Body() body: GithubLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookie = req.cookies?.[GITHUB_STATE_COOKIE];
    res.clearCookie(GITHUB_STATE_COOKIE, { path: GITHUB_STATE_COOKIE_PATH });
    const result = await this.authService.loginWithGitHub(
      body.code,
      { state: body.state, cookie },
      { userAgent: userAgentOf(req) },
    );
    return respondWithLogin(res, result);
  }

  /**
   * Liaison d'un compte GitHub au compte connecté (liaison explicite, jamais automatique).
   * S31 : mot de passe (ou connexion récente) et code MFA si actif, dans le corps.
   */
  @ForbiddenInImpersonation()
  @Post('github/link')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async linkGitHub(
    @Body() body: GithubLinkDto,
    @Req() req: Request & AuthenticatedUserRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookie = req.cookies?.[GITHUB_STATE_COOKIE];
    res.clearCookie(GITHUB_STATE_COOKIE, { path: GITHUB_STATE_COOKIE_PATH });
    return this.authService.linkGitHubAccount(
      req.user.id,
      body.code,
      { state: body.state, cookie },
      body,
      req.user.sid,
    );
  }

  /** Délie le compte GitHub (S31) : réauthentification, jamais la dernière méthode de connexion. */
  @ForbiddenInImpersonation()
  @Post('github/unlink')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async unlinkGitHub(@Body() body: IdentityUnlinkDto, @Req() req: AuthenticatedUserRequest) {
    await this.authService.unlinkIdentity(req.user.id, 'github', body, req.user.sid);
  }

  /** Délie le compte Firebase (S31). */
  @ForbiddenInImpersonation()
  @Post('firebase/unlink')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async unlinkFirebase(@Body() body: IdentityUnlinkDto, @Req() req: AuthenticatedUserRequest) {
    await this.authService.unlinkIdentity(req.user.id, 'firebase', body, req.user.sid);
  }

  /** Identités liées (adresse Firebase, nom GitHub) du compte connecté. */
  @Get('identities')
  async identities(@Req() req: AuthenticatedUserRequest) {
    return this.authService.getIdentities(req.user.id);
  }

  /**
   * Endpoint d'inscription classique : réponse générique 202, aucune session avant la
   * vérification de l'adresse e-mail (P6, S27).
   */
  @Public()
  @Post('register')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto.email, registerDto.passwordRaw, registerDto.name);
  }

  /** Confirme l'adresse e-mail avec le lien reçu (usage unique). */
  @Public()
  @Post('email/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyEmail(@Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(body.token);
  }

  /** Renvoie le lien de vérification (réponse générique). */
  @Public()
  @Post('email/resend')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async resendVerification(@Body() body: EmailOnlyDto) {
    return this.authService.resendVerification(body.email);
  }

  /** Demande de réinitialisation de mot de passe (réponse générique). */
  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async forgotPassword(@Body() body: EmailOnlyDto) {
    return this.authService.requestPasswordReset(body.email);
  }

  /** Réinitialisation du mot de passe avec le lien reçu : ferme toutes les sessions. */
  @Public()
  @Post('password/reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.password);
  }

  /**
   * Endpoint de login classique
   */
  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto.email, loginDto.passwordRaw, {
      userAgent: userAgentOf(req),
    });
    return respondWithLogin(res, result);
  }

  /**
   * Endpoint de validation du challenge MFA TOTP
   */
  @Public()
  @Post('mfa/challenge')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async verifyMfaChallenge(
    @Body() body: MfaChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyMfaChallenge(
      body.mfaTicket,
      { code: body.code, recoveryCode: body.recoveryCode },
      {
        userAgent: userAgentOf(req),
      },
    );
    return respondWithLogin(res, result);
  }

  /**
   * Rotation du jeton de rafraîchissement (cookie `refreshToken`, Path=/auth) : renvoie de
   * nouveaux cookies. Un jeton déjà utilisé révoque toute la session (vol présumé).
   */
  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const refreshed = await this.sessionService.refresh(readRefreshCookie(req), userAgentOf(req));
      setSessionCookies(res, refreshed);
      return { user: refreshed.user };
    } catch (error) {
      // Une session morte ne doit laisser aucun cookie périmé derrière elle
      if (!(error instanceof ConflictException)) {
        clearSessionCookies(res);
      }
      throw error;
    }
  }

  /**
   * Déconnexion serveur : révoque la session (même avec un jeton d'accès expiré, grâce au cookie
   * de rafraîchissement) et efface les deux cookies. Idempotente.
   */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sids = new Set<string>();
    const accessToken = readAccessCookie(req);
    if (accessToken) {
      try {
        sids.add((await this.tokenService.verifyAccessToken(accessToken)).sid);
      } catch {
        // jeton expiré ou invalide : on se rabat sur le cookie de rafraîchissement
      }
    }
    const refreshToken = readRefreshCookie(req);
    if (refreshToken) {
      const sid = await this.sessionService.findSidByRefreshToken(refreshToken);
      if (sid) sids.add(sid);
    }
    for (const sid of sids) {
      await this.sessionService.revoke(sid);
    }
    clearSessionCookies(res);
  }

  /**
   * Sessions actives du compte connecté (page « Sessions actives »).
   */
  @Get('sessions')
  async listSessions(@Req() req: AuthenticatedUserRequest) {
    return this.sessionService.listForUser(
      req.user.id,
      req.user.sid,
      Boolean(req.user.impersonatedBy),
    );
  }

  /**
   * Révoque une session du compte connecté (jamais celle d'un autre compte : 404). Le `sid` doit
   * être un UUID (400 sinon). La session courante se ferme par la déconnexion (409), pour ne pas
   * laisser des cookies orphelins.
   */
  @ForbiddenInImpersonation()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Delete('sessions/:sid')
  @HttpCode(204)
  async revokeSession(
    @Param('sid', new ParseUUIDPipe()) sid: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    // Les identifiants sont en minuscules : une casse différente ne doit pas contourner le 409
    const target = sid.toLowerCase();
    if (target === req.user.sid?.toLowerCase()) {
      throw new ConflictException('Utilisez « Se déconnecter » pour fermer la session courante.');
    }
    const revoked = await this.sessionService.revokeOwnSession(req.user.id, target);
    if (!revoked) {
      throw new NotFoundException('Session introuvable.');
    }
  }

  /**
   * Ferme toutes les autres sessions du compte (action de protection : sans réauthentification).
   * Route sans corps (S32) ; la session courante est conservée.
   */
  @ForbiddenInImpersonation()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOtherSessions(@Req() req: AuthenticatedUserRequest) {
    return this.authService.revokeOtherSessions(req.user.id, req.user.sid);
  }

  /**
   * État MFA du compte connecté (écran « Sécurité du compte »).
   */
  @ForbiddenInImpersonation()
  @Get('mfa/status')
  async mfaStatus(@Req() req: AuthenticatedUserRequest) {
    return this.authService.getMfaStatus(req.user.id);
  }

  /**
   * Endpoint d'initialisation du MFA TOTP (génère la clé et le QR code URI)
   */
  @ForbiddenInImpersonation()
  @Post('mfa/setup')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async setupMfa(@Body() body: SetupMfaDto, @Req() req: AuthenticatedUserRequest) {
    return this.authService.setupMfa(req.user.id, body, req.user.sid);
  }

  /**
   * Endpoint d'activation du MFA TOTP après saisie du premier code valide
   */
  @ForbiddenInImpersonation()
  @Post('mfa/confirm')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async confirmMfa(@Body() body: MfaCodeDto, @Req() req: AuthenticatedUserRequest) {
    return this.authService.confirmMfa(req.user.id, body.code);
  }

  /**
   * Endpoint de désactivation du MFA TOTP
   */
  @ForbiddenInImpersonation()
  @Post('mfa/disable')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async disableMfa(@Body() body: DisableMfaDto, @Req() req: AuthenticatedUserRequest) {
    return this.authService.disableMfa(req.user.id, body, req.user.sid);
  }

  /**
   * Régénère les codes de récupération (code TOTP et mot de passe requis) : affichés une seule fois.
   */
  @ForbiddenInImpersonation()
  @Post('mfa/recovery-codes')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async regenerateRecoveryCodes(
    @Body() body: RegenerateRecoveryCodesDto,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.authService.regenerateRecoveryCodes(req.user.id, body, req.user.sid);
  }

  @Public()
  @Post('firebase/login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async loginWithFirebase(
    @Body() body: FirebaseLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginWithFirebase(body.idToken, body.name, {
      userAgent: userAgentOf(req),
    });
    return respondWithLogin(res, result);
  }

  /**
   * Endpoint de liaison de compte Firebase pour un utilisateur déjà authentifié
   */
  @ForbiddenInImpersonation()
  @Post('firebase/link')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async linkFirebase(@Body() body: FirebaseLinkDto, @Req() req: AuthenticatedUserRequest) {
    return this.authService.linkFirebaseAccount(req.user.id, body.idToken, body, req.user.sid);
  }

  /**
   * Récupère les dépôts GitHub de l'utilisateur connecté. Interdit en impersonation : la route
   * utilise le jeton GitHub du compte ciblé.
   */
  @Get('github/repos')
  @ForbiddenInImpersonation()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  getGitHubRepositories(@Req() req: AuthenticatedUserRequest) {
    const userId = req.user.id;
    return this.authService.getGitHubRepositories(userId);
  }

  /**
   * Associe un dépôt GitHub à un projet Planner-Pro (P9-R) : droit `project.manage`, dépôt vérifié
   * chez GitHub avec le jeton de l'utilisateur. Le dépôt voyage dans le corps, jamais dans le chemin.
   */
  @Post('github/sync')
  @ForbiddenInImpersonation()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  syncRepository(@Body() body: GithubSyncDto, @Req() req: AuthenticatedUserRequest) {
    return this.authService.syncRepositoryToProject(req.user.id, body.projectId, body.repoFullName);
  }
}
