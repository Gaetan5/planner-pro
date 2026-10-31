import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotImplementedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { ConfigureSsoDto } from './sso.dto';
import { SSOProvider, WorkspaceRole } from '@prisma/client';

/**
 * Fournisseurs dont l'échange de code est réellement implémenté (S2).
 * SAML2 et OIDC_GENERIC ne le sont pas : aucune assertion ni aucun jeton n'est vérifié pour eux.
 */
export const IMPLEMENTED_SSO_PROVIDERS: SSOProvider[] = [
  SSOProvider.OIDC_AZURE_AD,
  SSOProvider.OIDC_GOOGLE,
];

function assertProviderImplemented(provider: SSOProvider): void {
  if (!IMPLEMENTED_SSO_PROVIDERS.includes(provider)) {
    throw new NotImplementedException(
      `Le fournisseur SSO ${provider} n'est pas encore pris en charge.`,
    );
  }
}

export interface SsoDiscoveryResult {
  ssoAvailable: boolean;
  domain?: string;
  provider?: SSOProvider;
  enforceSSO?: boolean;
  authUrl?: string;
}

@Injectable()
export class SsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Extrait le domaine d'une adresse email
   */
  extractDomain(email: string): string {
    const parts = email.toLowerCase().trim().split('@');
    if (parts.length !== 2 || !parts[1]) {
      throw new BadRequestException('Format d’adresse e-mail invalide.');
    }
    return parts[1];
  }

  /**
   * Découverte de configuration SSO par adresse e-mail d'entreprise
   */
  async discover(email: string): Promise<SsoDiscoveryResult> {
    const domain = this.extractDomain(email);

    const ssoConfig = await this.prisma.sSOConfiguration.findUnique({
      where: { domain },
    });

    if (!ssoConfig || !ssoConfig.enabled) {
      return { ssoAvailable: false };
    }

    return {
      ssoAvailable: true,
      domain: ssoConfig.domain,
      provider: ssoConfig.provider,
      enforceSSO: ssoConfig.enforceSSO,
      authUrl: `/api/auth/sso/authorize?domain=${encodeURIComponent(domain)}`,
    };
  }

  /**
   * Génère l'URL d'autorisation SSO pour le domaine demandé
   */
  async getAuthorizationUrl(domain: string, callbackUrl?: string): Promise<{ url: string }> {
    const ssoConfig = await this.prisma.sSOConfiguration.findUnique({
      where: { domain },
    });

    if (!ssoConfig || !ssoConfig.enabled) {
      throw new NotFoundException(`Aucune configuration SSO active pour le domaine ${domain}.`);
    }
    assertProviderImplemented(ssoConfig.provider);

    const redirect =
      callbackUrl ||
      `${process.env.APP_URL || 'https://planner-pro.boukarou-os.com'}/auth/sso/callback`;
    const state = Buffer.from(JSON.stringify({ domain, ts: Date.now() })).toString('base64url');

    if (ssoConfig.provider === SSOProvider.OIDC_AZURE_AD) {
      const tenant = ssoConfig.issuer || 'common';
      const authEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
      const url = `${authEndpoint}?client_id=${encodeURIComponent(
        ssoConfig.clientId || '',
      )}&response_type=code&redirect_uri=${encodeURIComponent(
        redirect,
      )}&response_mode=query&scope=${encodeURIComponent('openid profile email')}&state=${state}`;
      return { url };
    }

    if (ssoConfig.provider === SSOProvider.OIDC_GOOGLE) {
      const authEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
      const url = `${authEndpoint}?client_id=${encodeURIComponent(
        ssoConfig.clientId || '',
      )}&response_type=code&redirect_uri=${encodeURIComponent(
        redirect,
      )}&scope=${encodeURIComponent('openid profile email')}&state=${state}&access_type=offline`;
      return { url };
    }

    throw new BadRequestException(
      'Le fournisseur SSO configuré ne supporte pas la redirection automatique.',
    );
  }

  /**
   * Callback SSO : validation du code d'authentification et Just-In-Time Provisioning
   */
  async handleCallback(code: string, domain: string, redirectUri?: string, userAgent?: string) {
    const ssoConfig = await this.prisma.sSOConfiguration.findUnique({
      where: { domain },
      include: { workspace: true },
    });

    if (!ssoConfig || !ssoConfig.enabled) {
      throw new UnauthorizedException('Configuration SSO invalide ou désactivée.');
    }
    // Avant tout appel réseau, toute recherche ou création d'utilisateur
    assertProviderImplemented(ssoConfig.provider);

    const redirect =
      redirectUri ||
      `${process.env.APP_URL || 'https://planner-pro.boukarou-os.com'}/auth/sso/callback`;

    // Échange du code d'autorisation contre les informations de profil
    let email: string;
    let name: string;
    let ssoUid: string;

    if (ssoConfig.provider === SSOProvider.OIDC_AZURE_AD) {
      const tenant = ssoConfig.issuer || 'common';
      const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: ssoConfig.clientId || '',
          client_secret: ssoConfig.clientSecret || '',
          code,
          redirect_uri: redirect,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        throw new UnauthorizedException(
          'Échec de la validation du code SSO auprès de Microsoft Azure AD.',
        );
      }

      const tokenData = (await tokenRes.json()) as { id_token?: string; access_token?: string };
      if (!tokenData.id_token) {
        throw new UnauthorizedException("Jeton d'identité ID Token manquant.");
      }

      // Décoder le payload JWT (id_token)
      const payloadBase64 = tokenData.id_token.split('.')[1];
      const claims = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
      email = (claims.email || claims.preferred_username || claims.upn || '').toLowerCase().trim();
      name = claims.name || email.split('@')[0];
      ssoUid = `azure-ad:${claims.oid || claims.sub}`;
    } else if (ssoConfig.provider === SSOProvider.OIDC_GOOGLE) {
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: ssoConfig.clientId || '',
          client_secret: ssoConfig.clientSecret || '',
          code,
          redirect_uri: redirect,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        throw new UnauthorizedException(
          'Échec de validation du code SSO auprès de Google Workspace.',
        );
      }

      const tokenData = (await tokenRes.json()) as { id_token?: string };
      if (!tokenData.id_token) {
        throw new UnauthorizedException('Jeton Google ID Token manquant.');
      }

      const payloadBase64 = tokenData.id_token.split('.')[1];
      const claims = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
      email = (claims.email || '').toLowerCase().trim();
      name = claims.name || email.split('@')[0];
      ssoUid = `google:${claims.sub}`;
    } else {
      // Jamais atteint (assertProviderImplemented) : refus explicite par sécurité
      throw new NotImplementedException('Fournisseur SSO non pris en charge.');
    }

    if (!email) {
      throw new UnauthorizedException('Adresse e-mail introuvable dans la réponse SSO.');
    }

    // JIT Provisioning (Just-In-Time)
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { ssoUid }],
      },
    });

    if (user && user.isSuspended) {
      throw new ForbiddenException(
        'Votre compte entreprise est suspendu. Veuillez contacter votre administrateur.',
      );
    }

    if (!user) {
      if (!ssoConfig.autoProvision) {
        throw new ForbiddenException(
          "L'auto-provisioning est désactivé pour cette organisation. Veuillez contacter votre administrateur.",
        );
      }

      user = await this.prisma.user.create({
        data: {
          email,
          name,
          ssoUid,
        },
      });
    } else if (!user.ssoUid) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { ssoUid },
      });
    }

    // Rattachement automatique au Workspace selon le rôle par défaut configuré
    const existingMembership = await this.prisma.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: ssoConfig.workspaceId,
          userId: user.id,
        },
      },
    });

    if (!existingMembership) {
      await this.prisma.membership.create({
        data: {
          workspaceId: ssoConfig.workspaceId,
          userId: user.id,
          role: ssoConfig.defaultRole || WorkspaceRole.MEMBER,
        },
      });
    }

    // Session émise par le point d'entrée unique (A3)
    const login = await this.authService.completeLogin(user, { method: 'sso', userAgent });

    return { ...login, workspaceId: ssoConfig.workspaceId };
  }

  /**
   * Récupère la configuration SSO pour un Workspace
   */
  async getWorkspaceSSO(workspaceId: string, userId: string) {
    await this.verifyWorkspaceAdmin(workspaceId, userId);

    const config = await this.prisma.sSOConfiguration.findUnique({
      where: { workspaceId },
    });

    if (!config) {
      return null;
    }

    return {
      ...config,
      clientSecret: config.clientSecret ? '********' : null,
    };
  }

  /**
   * Crée ou met à jour la configuration SSO d'un Workspace
   */
  async configureWorkspaceSSO(workspaceId: string, userId: string, dto: ConfigureSsoDto) {
    await this.verifyWorkspaceAdmin(workspaceId, userId);

    const domain = dto.domain.toLowerCase().trim();

    // Vérifier si le domaine n'est pas déjà revendiqué par un autre workspace
    const existingDomain = await this.prisma.sSOConfiguration.findUnique({
      where: { domain },
    });

    if (existingDomain && existingDomain.workspaceId !== workspaceId) {
      throw new BadRequestException(
        `Le domaine ${domain} est déjà configuré par une autre organisation.`,
      );
    }

    return this.prisma.sSOConfiguration.upsert({
      where: { workspaceId },
      update: {
        provider: dto.provider,
        domain,
        clientId: dto.clientId,
        clientSecret: dto.clientSecret || undefined,
        discoveryUrl: dto.discoveryUrl,
        entryPoint: dto.entryPoint,
        cert: dto.cert,
        issuer: dto.issuer,
        defaultRole: dto.defaultRole,
        enforceSSO: dto.enforceSSO ?? false,
        autoProvision: dto.autoProvision ?? true,
        enabled: dto.enabled ?? true,
      },
      create: {
        workspaceId,
        provider: dto.provider,
        domain,
        clientId: dto.clientId,
        clientSecret: dto.clientSecret,
        discoveryUrl: dto.discoveryUrl,
        entryPoint: dto.entryPoint,
        cert: dto.cert,
        issuer: dto.issuer,
        defaultRole: dto.defaultRole,
        enforceSSO: dto.enforceSSO ?? false,
        autoProvision: dto.autoProvision ?? true,
        enabled: dto.enabled ?? true,
      },
    });
  }

  /**
   * Supprime la configuration SSO d'un Workspace
   */
  async deleteWorkspaceSSO(workspaceId: string, userId: string) {
    await this.verifyWorkspaceAdmin(workspaceId, userId);
    return this.prisma.sSOConfiguration.delete({
      where: { workspaceId },
    });
  }

  private async verifyWorkspaceAdmin(workspaceId: string, userId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });

    if (
      !membership ||
      (membership.role !== WorkspaceRole.OWNER && membership.role !== WorkspaceRole.ADMIN)
    ) {
      throw new ForbiddenException("Droits administrateur de l'espace de travail requis.");
    }
  }
}
