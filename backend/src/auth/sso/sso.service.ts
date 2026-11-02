import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { jwtVerify } from 'jose';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuthService } from '../auth.service';
import { decrypt, encrypt } from '../encryption.util';
import { ConfigureSsoDto } from './sso.dto';
import { SSOProvider, WorkspaceRole } from '@prisma/client';
import {
  AZURE_TENANT_GUID,
  DOMAIN_VERIFICATION_PREFIX,
  DomainVerifier,
  OidcKeySource,
  domainVerificationHost,
  newFlowSecrets,
  oidcEndpoints,
  pkceChallenge,
} from './oidc';

/** Délai maximal d'un appel au fournisseur d'identité (S10-f). */
const IDP_TIMEOUT_MS = 5000;

/** Durée de vie du `state` (flux d'autorisation) : 10 minutes. */
export const SSO_FLOW_TTL_SECONDS = 600;
const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;
const DOMAIN_FORMAT = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Rôles qu'un IdP peut conférer par défaut (S10). */
const ALLOWED_DEFAULT_ROLES: WorkspaceRole[] = [WorkspaceRole.MEMBER, WorkspaceRole.VIEWER];

const flowKey = (state: string) => `sso:flow:${createHash('sha256').update(state).digest('hex')}`;

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

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return (
    left.length === right.length && timingSafeEqual(new Uint8Array(left), new Uint8Array(right))
  );
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
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly redis: RedisService,
    private readonly keySource: OidcKeySource,
    private readonly domainVerifier: DomainVerifier,
  ) {}

  /**
   * URL de retour fixée côté serveur : origine de FRONTEND_URL + /auth/sso/callback (S10-c).
   * Le repli sur localhost n'existe qu'hors production ; en production, FRONTEND_URL est obligatoire.
   */
  private redirectUri(): string {
    const frontendUrl =
      process.env.FRONTEND_URL ||
      (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
    if (!frontendUrl) {
      throw new ServiceUnavailableException(
        "SSO indisponible : la variable d'environnement FRONTEND_URL est obligatoire en production.",
      );
    }
    return `${new URL(frontendUrl).origin}/auth/sso/callback`;
  }

  /** Secret IdP stocké chiffré ; un secret encore en clair (avant le script) reste lisible. */
  private readClientSecret(stored: string | null): string {
    if (!stored) return '';
    return ENCRYPTED_FORMAT.test(stored) ? decrypt(stored) : stored;
  }

  /** Configuration utilisable pour une connexion : active ET domaine prouvé via verifiedDomain (S10, S10-a). */
  private async findUsableConfig(domain: string) {
    const config = await this.prisma.sSOConfiguration.findUnique({
      where: { verifiedDomain: domain.toLowerCase().trim() },
    });
    if (!config || !config.enabled || !config.domainVerifiedAt) return null;
    return config;
  }

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
    const ssoConfig = await this.findUsableConfig(domain);

    if (!ssoConfig) {
      return { ssoAvailable: false };
    }

    return {
      ssoAvailable: true,
      domain: ssoConfig.domain,
      provider: ssoConfig.provider,
      enforceSSO: ssoConfig.enforceSSO,
      authUrl: `/auth/sso/authorize?domain=${encodeURIComponent(domain)}`,
    };
  }

  /**
   * Démarre le flux d'autorisation : `state` (32 octets), `nonce` et PKCE générés côté serveur,
   * conservés en Redis 10 minutes (S10). Le contrôleur lie le `state` au navigateur par cookie.
   */
  async getAuthorizationUrl(domain: string): Promise<{ url: string; state: string }> {
    const ssoConfig = await this.findUsableConfig(domain.toLowerCase().trim());
    if (!ssoConfig) {
      throw new NotFoundException(`Aucune configuration SSO active pour le domaine ${domain}.`);
    }
    assertProviderImplemented(ssoConfig.provider);
    const endpoints = this.endpointsFor(ssoConfig);

    if (!ssoConfig.clientId) {
      throw new BadRequestException(
        'Configuration SSO invalide : identifiant client (clientId) manquant.',
      );
    }

    const redirectUri = this.redirectUri();
    const { state, nonce, codeVerifier } = newFlowSecrets();
    try {
      await this.redis.set(
        flowKey(state),
        JSON.stringify({ domain: ssoConfig.domain, nonce, codeVerifier }),
        SSO_FLOW_TTL_SECONDS,
      );
    } catch {
      throw new ServiceUnavailableException('Service SSO momentanément indisponible.');
    }

    const params = new URLSearchParams({
      client_id: ssoConfig.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: pkceChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });
    if (ssoConfig.provider === SSOProvider.OIDC_AZURE_AD) params.set('response_mode', 'query');
    return { url: `${endpoints.authorize}?${params.toString()}`, state };
  }

  private endpointsFor(config: { provider: SSOProvider; issuer: string | null }) {
    try {
      return oidcEndpoints(config.provider, config.issuer);
    } catch {
      throw new BadRequestException(
        "Configuration SSO invalide : l'identifiant de tenant Azure (GUID) est requis.",
      );
    }
  }

  /**
   * Callback SSO : `state` (cookie + Redis, consommé une fois), échange du code avec PKCE,
   * validation complète de l'`id_token`, puis liaison par identité ou par domaine vérifié (S10).
   */
  async handleCallback(code: string, state: string, flowCookie?: string, userAgent?: string) {
    const context: { workspaceId?: string } = {};
    try {
      return await this.processCallback(code, state, flowCookie, userAgent, context);
    } catch (error) {
      // Aucun jeton, code, state ni adresse dans le journal (S10-i)
      this.logger.warn(
        JSON.stringify({
          event: 'SSO_LOGIN_FAILURE',
          workspaceId: context.workspaceId ?? null,
          status: error instanceof HttpException ? error.getStatus() : 500,
          reason: error instanceof HttpException ? error.message : 'ERREUR_INTERNE',
        }),
      );
      throw error;
    }
  }

  private async processCallback(
    code: string,
    state: string,
    flowCookie: string | undefined,
    userAgent: string | undefined,
    context: { workspaceId?: string },
  ) {
    const invalid = () => new UnauthorizedException('Échec de la connexion SSO : session expirée.');
    if (!state.startsWith('sso_') || !flowCookie || !safeEqual(state, flowCookie)) throw invalid();

    let raw: string | null;
    try {
      raw = await this.redis.getAndDelete(flowKey(state));
    } catch {
      throw new ServiceUnavailableException('Service SSO momentanément indisponible.');
    }
    if (!raw) throw invalid();
    const flow = JSON.parse(raw) as { domain: string; nonce: string; codeVerifier: string };

    const ssoConfig = await this.findUsableConfig(flow.domain);
    if (!ssoConfig) {
      throw new UnauthorizedException('Configuration SSO invalide ou désactivée.');
    }
    context.workspaceId = ssoConfig.workspaceId;
    // Avant tout appel réseau, toute recherche ou création d'utilisateur
    assertProviderImplemented(ssoConfig.provider);
    if (!ssoConfig.clientId) {
      throw new UnauthorizedException(
        'Configuration SSO invalide : identifiant client (clientId) manquant.',
      );
    }
    const endpoints = this.endpointsFor(ssoConfig);

    let clientSecret: string;
    try {
      clientSecret = this.readClientSecret(ssoConfig.clientSecret);
    } catch {
      // Ni le secret ni le texte chiffré ne sont journalisés (S10-f)
      this.logger.error(
        JSON.stringify({
          event: 'SSO_SECRET_DECRYPT_FAILURE',
          workspaceId: ssoConfig.workspaceId,
        }),
      );
      throw new ServiceUnavailableException('Service SSO momentanément indisponible.');
    }

    let tokenRes: Response;
    try {
      tokenRes = await fetch(endpoints.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: ssoConfig.clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: this.redirectUri(),
          grant_type: 'authorization_code',
          code_verifier: flow.codeVerifier,
        }),
        signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
      });
    } catch {
      // Délai dépassé ou erreur réseau (S10-f)
      throw new ServiceUnavailableException('Fournisseur SSO momentanément indisponible.');
    }
    if (!tokenRes.ok) {
      throw new UnauthorizedException('Échec de la validation du code SSO auprès du fournisseur.');
    }
    let tokenData: { id_token?: string };
    try {
      tokenData = (await tokenRes.json()) as { id_token?: string };
    } catch {
      throw new UnauthorizedException("Réponse invalide du fournisseur d'identité.");
    }
    if (!tokenData.id_token) {
      throw new UnauthorizedException("Jeton d'identité manquant.");
    }

    const claims = await this.verifyIdToken(tokenData.id_token, ssoConfig, endpoints, flow.nonce);
    const identity = this.identityFromClaims(claims, ssoConfig);

    // Une adresse hors du domaine prouvé n'est jamais acceptée, quel que soit l'IdP (S10)
    if (this.extractDomain(identity.email) !== ssoConfig.domain) {
      throw new ConflictException(
        "L'adresse e-mail du compte d'entreprise n'appartient pas au domaine de cette organisation.",
      );
    }

    let user = await this.prisma.user.findFirst({ where: { ssoUid: identity.ssoUid } });
    // Un compte lié par ssoUid doit lui aussi appartenir au domaine prouvé (liaisons héritées : S10-d)
    if (user && this.extractDomain(user.email) !== ssoConfig.verifiedDomain) {
      throw new ConflictException(
        "Ce compte n'appartient pas au domaine de cette organisation. Contactez votre administrateur.",
      );
    }
    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: identity.email } });
      if (byEmail) {
        if (byEmail.ssoUid && byEmail.ssoUid !== identity.ssoUid) {
          throw new ConflictException(
            'Ce compte est déjà lié à une autre identité d’entreprise. Contactez votre administrateur.',
          );
        }
        user = byEmail;
      }
    }

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
          email: identity.email,
          name: identity.name,
          ssoUid: identity.ssoUid,
          // Adresse du domaine prouvé, attestée par l'IdP de l'organisation
          emailVerifiedAt: new Date(),
        },
      });
    } else if (user.ssoUid !== identity.ssoUid) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          ssoUid: identity.ssoUid,
          ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
        },
      });
    }

    // Rattachement au Workspace avec un rôle borné (jamais OWNER ni ADMIN)
    const existingMembership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: ssoConfig.workspaceId, userId: user.id } },
    });
    if (!existingMembership) {
      const role = ALLOWED_DEFAULT_ROLES.includes(ssoConfig.defaultRole)
        ? ssoConfig.defaultRole
        : WorkspaceRole.MEMBER;
      await this.prisma.membership.create({
        data: { workspaceId: ssoConfig.workspaceId, userId: user.id, role },
      });
    }

    // Session émise par le point d'entrée unique (A3)
    const login = await this.authService.completeLogin(user, { method: 'sso', userAgent });

    return { ...login, workspaceId: ssoConfig.workspaceId };
  }

  /** Signature, émetteur, audience, expiration et nonce de l'`id_token` (S10, S10-b). */
  private async verifyIdToken(
    idToken: string,
    config: { provider: SSOProvider; clientId: string | null },
    endpoints: { issuer: string; jwks: string },
    nonce: string,
  ): Promise<Record<string, unknown>> {
    if (!config.clientId) {
      throw new UnauthorizedException(
        'Configuration SSO invalide : identifiant client (clientId) manquant.',
      );
    }
    try {
      const { payload } = await jwtVerify(idToken, this.keySource.getKeys(endpoints.jwks), {
        issuer: endpoints.issuer,
        audience: config.clientId,
        algorithms: ['RS256'],
        clockTolerance: 60,
      });
      if (!payload.exp || !payload.iat) throw new Error('exp/iat manquants');
      if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, nonce)) {
        throw new Error('nonce');
      }
      return payload as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException("Jeton d'identité invalide.");
    }
  }

  private identityFromClaims(
    claims: Record<string, unknown>,
    config: { provider: SSOProvider; issuer: string | null; domain: string },
  ): { email: string; name: string; ssoUid: string } {
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    let email: string;
    let ssoUid: string;

    if (config.provider === SSOProvider.OIDC_AZURE_AD) {
      const tid = text(claims.tid);
      const oid = text(claims.oid);
      if (!tid || !oid || tid.toLowerCase() !== (config.issuer || '').toLowerCase()) {
        throw new UnauthorizedException("Jeton d'identité d'un autre tenant.");
      }
      // Invité du tenant (acct = 1) ou domaine non vérifié par Entra (xms_edov = false) : refusés (S10-i)
      if (claims.acct === 1 || claims.xms_edov === false) {
        throw new UnauthorizedException(
          'Compte invité ou adresse non vérifiée par le tenant : connexion refusée.',
        );
      }
      email = (text(claims.email) || text(claims.preferred_username)).toLowerCase();
      ssoUid = `azure-ad:${tid.toLowerCase()}:${oid}`;
    } else {
      if (claims.email_verified !== true || text(claims.hd).toLowerCase() !== config.domain) {
        throw new UnauthorizedException(
          "L'adresse Google doit être vérifiée et appartenir au domaine de l'organisation.",
        );
      }
      email = text(claims.email).toLowerCase();
      ssoUid = `google:${text(claims.sub)}`;
    }

    if (!/^[^@\s]+@[^@\s]+$/.test(email) || ssoUid.endsWith(':')) {
      throw new UnauthorizedException('Adresse e-mail introuvable dans la réponse SSO.');
    }
    return { email, name: text(claims.name) || email.split('@')[0], ssoUid };
  }

  /** Configuration sans secret : le jeton de vérification DNS est destiné aux administrateurs. */
  private toAdminView(
    config: {
      clientSecret: string | null;
      domain: string;
      domainVerificationToken: string | null;
    } & Record<string, unknown>,
  ) {
    return {
      ...config,
      clientSecret: config.clientSecret ? '********' : null,
      dnsVerification: config.domainVerificationToken
        ? {
            host: domainVerificationHost(config.domain),
            type: 'TXT',
            value: `${DOMAIN_VERIFICATION_PREFIX}${config.domainVerificationToken}`,
          }
        : null,
    };
  }

  /**
   * Récupère la configuration SSO pour un Workspace
   */
  async getWorkspaceSSO(workspaceId: string, userId: string) {
    await this.verifyWorkspaceAdmin(workspaceId, userId);

    const config = await this.prisma.sSOConfiguration.findUnique({
      where: { workspaceId },
    });

    return config ? this.toAdminView(config) : null;
  }

  /**
   * Crée ou met à jour la configuration SSO d'un Workspace. Le SSO n'est activable qu'après la
   * preuve DNS du domaine ; changer de domaine remet la preuve à zéro (S10).
   */
  async configureWorkspaceSSO(workspaceId: string, userId: string, dto: ConfigureSsoDto) {
    const role = await this.verifyWorkspaceAdmin(workspaceId, userId);

    const domain = dto.domain.toLowerCase().trim();
    if (!DOMAIN_FORMAT.test(domain)) {
      throw new BadRequestException('Domaine de messagerie invalide (ex : acme.com).');
    }
    if (dto.provider === SSOProvider.OIDC_AZURE_AD && !AZURE_TENANT_GUID.test(dto.issuer || '')) {
      throw new BadRequestException(
        "Pour Azure AD, 'issuer' doit être l'identifiant de tenant (GUID) : common, organizations et consumers sont refusés.",
      );
    }

    const own = await this.prisma.sSOConfiguration.findUnique({ where: { workspaceId } });
    if (!dto.clientId && !own?.clientId) {
      throw new BadRequestException("L'identifiant client (clientId) est requis.");
    }
    if (!dto.clientSecret && !own?.clientSecret) {
      throw new BadRequestException('Le secret client (clientSecret) est requis.');
    }

    // Un domaine déjà PROUVÉ par un autre workspace est inaccessible. Les revendications non
    // prouvées coexistent : la première preuve DNS gagne, aucune ligne d'autrui n'est touchée (S10-a).
    const verifiedOther = await this.prisma.sSOConfiguration.findUnique({
      where: { verifiedDomain: domain },
    });
    if (verifiedOther && verifiedOther.workspaceId !== workspaceId) {
      throw new BadRequestException(
        `Le domaine ${domain} est déjà vérifié par une autre organisation.`,
      );
    }

    const domainChanged = !own || own.domain !== domain;
    const verifiedDomain = domainChanged ? null : own.verifiedDomain;
    const verifiedAt = domainChanged ? null : own.domainVerifiedAt;
    const token =
      domainChanged || !own.domainVerificationToken
        ? randomBytes(16).toString('hex')
        : own.domainVerificationToken;

    // Changer de fournisseur, de tenant ou de client sur un domaine prouvé : OWNER seul, et la
    // configuration est désactivée (aucune nouvelle preuve ne couvre le nouvel IdP : S10-e).
    const newIssuer = dto.issuer?.toLowerCase() ?? null;
    const changedFields: string[] = [];
    if (own && own.domainVerifiedAt && !domainChanged) {
      if (own.provider !== dto.provider) changedFields.push('provider');
      if ((own.issuer?.toLowerCase() ?? null) !== newIssuer) changedFields.push('issuer');
      if (dto.clientId && dto.clientId !== own.clientId) changedFields.push('clientId');
    }
    const idpChanged = changedFields.length > 0;
    if (idpChanged && role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException(
        "Seul le propriétaire de l'espace de travail peut changer de fournisseur, de tenant ou de client SSO.",
      );
    }

    const enabled = idpChanged
      ? false
      : (dto.enabled ?? (verifiedAt ? (own?.enabled ?? false) : false));
    const enforceSSO = idpChanged ? false : (dto.enforceSSO ?? false);
    if ((enabled || enforceSSO) && !verifiedAt) {
      throw new BadRequestException(
        'Le domaine doit être vérifié (enregistrement DNS TXT) avant d’activer le SSO.',
      );
    }

    const data = {
      provider: dto.provider,
      domain,
      verifiedDomain,
      clientId: dto.clientId ?? own?.clientId,
      ...(dto.clientSecret ? { clientSecret: encrypt(dto.clientSecret) } : {}),
      discoveryUrl: null,
      entryPoint: null,
      cert: null,
      issuer: newIssuer,
      defaultRole: dto.defaultRole ?? WorkspaceRole.MEMBER,
      enforceSSO,
      autoProvision: dto.autoProvision ?? true,
      enabled,
      domainVerificationToken: token,
      domainVerifiedAt: verifiedAt,
    };

    const saved = await this.prisma.sSOConfiguration.upsert({
      where: { workspaceId },
      update: data,
      create: {
        workspaceId,
        ...data,
        clientSecret: dto.clientSecret ? encrypt(dto.clientSecret) : undefined,
      },
    });
    if (idpChanged) {
      this.logger.log(
        JSON.stringify({
          event: 'SSO_CONFIG_IDP_CHANGED',
          workspaceId,
          userId,
          changed: changedFields,
        }),
      );
    }
    return this.toAdminView(saved);
  }

  /**
   * Vérifie l'enregistrement TXT `planner-pro-verification=<jeton>` sur `_planner-pro.<domaine>`
   * et marque le domaine comme prouvé via verifiedDomain (S10, S10-a).
   */
  async verifyDomain(workspaceId: string, userId: string) {
    await this.verifyWorkspaceAdmin(workspaceId, userId);
    const config = await this.prisma.sSOConfiguration.findUnique({ where: { workspaceId } });
    if (!config || !config.domainVerificationToken) {
      throw new NotFoundException('Aucune configuration SSO à vérifier.');
    }
    if (config.domainVerifiedAt && config.verifiedDomain === config.domain) {
      return this.toAdminView(config);
    }

    let found: boolean;
    try {
      found = await this.domainVerifier.hasVerificationToken(
        config.domain,
        config.domainVerificationToken,
      );
    } catch {
      throw new ServiceUnavailableException('Résolution DNS momentanément indisponible.');
    }
    if (!found) {
      throw new BadRequestException(
        `Enregistrement TXT introuvable : publiez ${DOMAIN_VERIFICATION_PREFIX}${config.domainVerificationToken} sur ${domainVerificationHost(config.domain)}, puis réessayez (la propagation DNS peut prendre du temps).`,
      );
    }

    // Si une autre organisation a déjà prouvé ce domaine entre-temps : 409 (S10-a)
    const alreadyVerified = await this.prisma.sSOConfiguration.findUnique({
      where: { verifiedDomain: config.domain },
    });
    if (alreadyVerified && alreadyVerified.id !== config.id) {
      throw new ConflictException(
        `Le domaine ${config.domain} a déjà été vérifié par une autre organisation.`,
      );
    }

    // Conditionnel : le domaine ne doit pas avoir changé entre la lecture et l'écriture,
    // et verifiedDomain est assigné de façon atomique (S10-a).
    let updated: { count: number };
    try {
      updated = await this.prisma.sSOConfiguration.updateMany({
        where: { id: config.id, domain: config.domain, verifiedDomain: null },
        data: {
          domainVerifiedAt: new Date(),
          verifiedDomain: config.domain,
        },
      });
    } catch (error) {
      // Course perdue contre la contrainte unique sur verifiedDomain (S10-f)
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `Le domaine ${config.domain} a déjà été vérifié par une autre organisation.`,
        );
      }
      throw error;
    }
    if (updated.count !== 1) {
      throw new ConflictException('La configuration a changé pendant la vérification.');
    }
    const fresh = await this.prisma.sSOConfiguration.findUnique({ where: { workspaceId } });
    return this.toAdminView(fresh as NonNullable<typeof fresh>);
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

  private async verifyWorkspaceAdmin(workspaceId: string, userId: string): Promise<WorkspaceRole> {
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
    return membership.role;
  }
}
