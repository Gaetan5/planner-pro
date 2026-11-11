import {
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { encrypt, decrypt, hashPassword, verifyPassword } from './encryption.util';
import { generateWebhookSecret } from '../projects/github-webhook.util';
import { FirebaseIdentityService } from './firebase-identity.service';
import { generateTotpSecret, verifyTotpStep, getTotpAuthUri } from './totp.util';
import { DisableMfaDto, RegenerateRecoveryCodesDto, SetupMfaDto } from './dto/mfa.dto';
import { IdentityReauthDto } from './dto/identity.dto';
import { GITHUB_REPO_FULL_NAME, GithubPurpose } from './dto/github.dto';
import { createGithubOAuthState, verifyGithubOAuthState } from './github-oauth-state';
import { TokenService, MFA_TICKET_TTL_SECONDS } from './token.service';
import { SessionService } from './session.service';
import { LoginResult, MfaLoginResult, SessionLoginResult } from './login-result';
import { isFeatureEnabled } from '../config/features';
import { isDevAuthEnabled } from './dev-auth-flag';
import { AccountLockout } from './account-lockout';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { PolicyService } from '../authz/policy.service';

/** Format d'un secret chiffré par `encrypt()` (iv:tag:data) ; un secret base32 en clair n'a jamais de « : ». */
const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;
/** Codes de récupération MFA (S6) : 10 codes de 10 caractères, alphabet sans ambiguïté (0/O, 1/I). */
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Réauthentification récente exigée des comptes sans mot de passe (S6). */
const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

/** Durées de vie des liens envoyés par e-mail (P6). */
const EMAIL_VERIFICATION_TTL_MS = 24 * 3600 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** Réponses génériques : identiques que l'adresse existe ou non (anti-énumération, S27). */
const REGISTER_ACCEPTED_MESSAGE =
  "Si cette adresse est disponible, un e-mail de confirmation vient d'être envoyé.";
const VERIFICATION_RESENT_MESSAGE =
  "Si un compte non vérifié existe pour cette adresse, un nouvel e-mail de confirmation vient d'être envoyé.";
const PASSWORD_RESET_REQUESTED_MESSAGE =
  'Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé.';

/**
 * Hachage Argon2id factice (mêmes paramètres que les vrais) : `login` le vérifie quand le compte
 * n'existe pas ou n'a pas de mot de passe, pour que le temps de réponse ne révèle pas l'existence
 * d'une adresse (S27). Calculé une fois, à la première utilisation.
 */
let dummyPasswordHash: Promise<string> | null = null;
const getDummyPasswordHash = () =>
  (dummyPasswordHash ??= hashPassword(randomBytes(16).toString('hex')));

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Délai maximal d'un appel à l'API GitHub pour les dépôts (P9-R). */
const GITHUB_API_TIMEOUT_MS = 5000;
/** Nombre maximal d'essais de code par ticket MFA (S3). */
const MFA_TICKET_MAX_ATTEMPTS = 5;
/** Délai maximal d'un appel Redis du parcours MFA : au-delà, 503 plutôt qu'une requête bloquée. */
export const MFA_REDIS_TIMEOUT_MS = 2000;
/** Jeton d'injection du délai Redis (O19) : les tests le raccourcissent, la production garde 2 s. */
export const MFA_REDIS_TIMEOUT_TOKEN = 'MFA_REDIS_TIMEOUT_MS';

/** Contexte client d'une connexion (A3) : transmis à l'émission de la session. */
export interface LoginContext {
  userAgent?: string;
}

/** Méthode d'authentification ayant abouti : détermine la politique appliquée (S8). */
export type LoginMethod =
  'password' | 'github' | 'firebase' | 'sso' | 'mfa' | 'register' | 'impersonation' | 'mock';

export interface CompleteLoginOptions extends LoginContext {
  method: LoginMethod;
  /** Méthode d'origine d'un challenge MFA (le ticket la conserve). */
  primaryMethod?: LoginMethod;
  impersonatedBy?: string;
}

/** Champs de l'utilisateur nécessaires à la politique de connexion. */
export interface LoginCandidate {
  id: string;
  email: string;
  name: string | null;
  platformRole?: string | null;
  isSuspended?: boolean;
  mfaEnabled?: boolean;
}

interface GitHubTokenResponse {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
}

/** `state` renvoyé par GitHub et valeur du cookie signé émis par ce navigateur (S9). */
export interface GithubOAuthState {
  state?: string;
  cookie?: string;
}

interface GitHubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  stargazers_count: number;
  language: string | null;
}

/**
 * Reste-t-il un autre moyen de se connecter une fois `provider` délié ? Mot de passe, SSO ou
 * l'autre identité externe. Règle unique : contrôle de `unlinkIdentity` et `canUnlink` de
 * `getIdentities` (P9-L-a). L'écriture conditionnelle de `unlinkIdentity` en est le miroir SQL.
 * Un `ssoUid` ne compte que si le SSO du domaine de l'adresse est encore utilisable (`ssoActive`,
 * voir `hasActiveSso`) : un identifiant hérité d'une configuration supprimée ou désactivée ne
 * permet plus de se connecter.
 */
function hasOtherLoginMethod(
  account: {
    passwordHash: string | null;
    ssoUid: string | null;
    firebaseUid: string | null;
    githubId: string | null;
  },
  provider: 'firebase' | 'github',
  ssoActive: boolean,
): boolean {
  return (
    Boolean(account.passwordHash) ||
    (Boolean(account.ssoUid) && ssoActive) ||
    Boolean(provider === 'firebase' ? account.githubId : account.firebaseUid)
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly firebaseIdentity: FirebaseIdentityService,
    private readonly redis: RedisService,
    private readonly sessionService: SessionService,
    private readonly mail: MailService,
    private readonly policy: PolicyService,
    @Optional()
    @Inject(MFA_REDIS_TIMEOUT_TOKEN)
    private readonly redisTimeoutMs: number = MFA_REDIS_TIMEOUT_MS,
  ) {
    // Limite des échecs par compte, en plus de la limite par IP du contrôleur (S24)
    this.loginLockout = new AccountLockout(this.redis, 'login');
    this.mfaLockout = new AccountLockout(this.redis, 'mfa');
  }

  private readonly loginLockout: AccountLockout;
  private readonly mfaLockout: AccountLockout;

  /**
   * Seul point d'émission de session de l'application (A3). Applique, dans l'ordre et pour
   * TOUTES les méthodes (S8) :
   *  1. compte suspendu : 403 ;
   *  2. `enforceSSO` du domaine : mot de passe, GitHub et Firebase refusés (403) ;
   *  3. MFA actif : ticket à usage unique à la place de la session ;
   *  4. émission de la session.
   * L'impersonation (administrateur déjà authentifié) n'est pas soumise à `enforceSSO` ni au MFA
   * du compte cible, mais reste refusée pour un compte suspendu.
   */
  async completeLogin(
    user: LoginCandidate,
    options: CompleteLoginOptions & { method: 'mfa' | 'impersonation' },
  ): Promise<SessionLoginResult>;
  async completeLogin(user: LoginCandidate, options: CompleteLoginOptions): Promise<LoginResult>;
  async completeLogin(user: LoginCandidate, options: CompleteLoginOptions): Promise<LoginResult> {
    if (user.isSuspended) {
      throw new ForbiddenException(
        "Ce compte utilisateur est suspendu. Veuillez contacter l'administrateur.",
      );
    }

    const origin = options.primaryMethod ?? options.method;
    if (origin !== 'sso' && origin !== 'impersonation') {
      await this.assertSsoNotEnforced(user.email);
    }

    if (user.mfaEnabled && options.method !== 'mfa' && options.method !== 'impersonation') {
      return this.issueMfaTicket(user, options.method);
    }

    const session = await this.sessionService.issue(
      { id: user.id, email: user.email, name: user.name },
      { userAgent: options.userAgent, impersonatedBy: options.impersonatedBy },
    );
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole ?? null,
      },
      session,
    };
  }

  /**
   * `enforceSSO` : le domaine de l'e-mail exige le SSO. Appliqué seulement si la fonctionnalité
   * SSO est active (P3) ET si la propriété du domaine est prouvée par DNS (S10) : sinon, un
   * `enforceSSO` posé par un tiers permettrait de verrouiller les comptes d'une autre organisation.
   */
  async assertSsoNotEnforced(email: string): Promise<void> {
    if (!isFeatureEnabled('SSO')) return;
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return;
    // Source de vérité unique : verifiedDomain (unique), posé seulement par la preuve DNS (S10-h)
    const config = await this.prisma.sSOConfiguration.findUnique({
      where: { verifiedDomain: domain },
      select: { enabled: true, enforceSSO: true },
    });
    if (config?.enabled && config.enforceSSO) {
      throw new ForbiddenException(
        'Votre organisation impose la connexion SSO. Utilisez « SSO Entreprise ».',
      );
    }
  }

  /** Ticket MFA à usage unique ; la méthode d'origine est conservée pour le challenge (S3, S8). */
  private async issueMfaTicket(user: LoginCandidate, method: LoginMethod): Promise<MfaLoginResult> {
    const { ticket: mfaTicket, jti } = this.tokenService.signMfaTicket(user.id);
    await this.withRedisTimeout(() =>
      this.redis.set(this.mfaTicketKey(jti), `${user.id}|${method}`, MFA_TICKET_TTL_SECONDS),
    );
    return { mfaRequired: true, mfaTicket, user: { id: user.id, email: user.email } };
  }

  async loginWithFirebase(
    idToken: string,
    suppliedName?: string,
    ctx: LoginContext = {},
  ): Promise<LoginResult> {
    const identity = await this.firebaseIdentity.verifyIdToken(idToken);
    const email = identity.email?.toLowerCase().trim();

    if (!email || !identity.email_verified) {
      throw new UnauthorizedException('Une adresse e-mail Firebase vérifiée est requise.');
    }

    let user = await this.prisma.user.findUnique({
      where: { firebaseUid: identity.uid },
    });

    if (!user) {
      const existingUser = await this.prisma.user.findUnique({ where: { email } });

      if (existingUser) {
        // Jamais de liaison automatique par e-mail (S8) : un compte créé ailleurs (mot de passe,
        // GitHub, ou provisionné par SCIM) ne doit pas être réclamé par une identité externe.
        throw new ConflictException(
          'Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec votre méthode habituelle (ou « Mot de passe oublié » si vous n’avez pas finalisé votre inscription), puis liez votre compte Firebase depuis « Sécurité du compte ».',
        );
      } else {
        await this.assertSsoNotEnforced(email);
        const name = identity.name || suppliedName?.trim() || email.split('@')[0];
        user = await this.prisma.$transaction(async (transaction) => {
          const createdUser = await transaction.user.create({
            data: { email, name, firebaseUid: identity.uid, emailVerifiedAt: new Date() },
          });
          await this.createOnboardingData(transaction, createdUser.id, name);
          return createdUser;
        });
      }
    }

    return this.completeLogin(user, { ...ctx, method: 'firebase' });
  }

  /**
   * Associe de manière vérifiée un UID Firebase à un compte utilisateur existant (liaison
   * explicite). S31 : réauthentification (mot de passe ou connexion récente, plus le second
   * facteur si la MFA est active) AVANT toute lecture du jeton et toute écriture. Aucun compte
   * Firebase n'est jamais créé côté serveur.
   */
  async linkFirebaseAccount(
    userId: string,
    idToken: string,
    reauth: IdentityReauthDto = {},
    sid?: string,
  ) {
    const account = await this.loadIdentityAccount(userId);
    await this.assertIdentityReauth(account, reauth, sid);

    const identity = await this.firebaseIdentity.verifyIdToken(idToken);
    const email = identity.email?.toLowerCase().trim();

    if (!email || !identity.email_verified) {
      throw new BadRequestException('Une adresse e-mail Firebase vérifiée est requise.');
    }

    const existingWithUid = await this.prisma.user.findUnique({
      where: { firebaseUid: identity.uid },
    });

    if (existingWithUid && existingWithUid.id !== userId) {
      throw new ConflictException('Cet identifiant Firebase est déjà lié à un autre compte.');
    }
    if (account.firebaseUid && account.firebaseUid !== identity.uid) {
      throw new ConflictException('Déliez d’abord le compte Firebase actuel.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { firebaseUid: identity.uid, firebaseEmail: email },
      select: {
        id: true,
        email: true,
        name: true,
        firebaseUid: true,
        platformRole: true,
      },
    });
    await this.recordIdentityChange(account, 'IDENTITY_LINKED', 'Firebase', email, sid);

    return {
      message: 'Compte Firebase associé avec succès.',
      user: updated,
      firebaseEmail: email,
    };
  }

  /**
   * URL d'autorisation GitHub (S9) : `state` aléatoire (cookie signé de 10 min posé par le
   * contrôleur), `redirect_uri` fixé côté serveur, portée minimale. `repo` n'est demandé que pour
   * l'action « connecter un dépôt ».
   */
  buildGithubAuthorizeUrl(purpose: GithubPurpose): { url: string; cookieValue: string } {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      throw new ServiceUnavailableException("L'authentification GitHub n'est pas configurée.");
    }
    const { state, cookieValue } = createGithubOAuthState(purpose);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: new URL(process.env.FRONTEND_URL || 'http://localhost:3000').origin,
      scope: purpose === 'repos' ? 'read:user user:email repo' : 'read:user user:email',
      state,
    });
    return { url: `https://github.com/login/oauth/authorize?${params.toString()}`, cookieValue };
  }

  /**
   * Échange le code contre un jeton, puis lit le profil et les e-mails. Chaque réponse GitHub est
   * contrôlée (`res.ok`). Seuls les e-mails marqués `verified` sont retenus : l'e-mail public du
   * profil n'est jamais utilisé comme identité (S9).
   */
  private async fetchGitHubIdentity(code: string) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException("L'authentification GitHub n'est pas configurée.");
    }
    const failed = () => new UnauthorizedException('Échec OAuth GitHub.');
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Planner-Pro-App',
    });

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    if (!tokenResponse.ok) throw failed();
    const tokenData = (await tokenResponse.json()) as GitHubTokenResponse;
    if (tokenData.error || !tokenData.access_token) throw failed();
    const accessToken = tokenData.access_token;

    const userResponse = await fetch('https://api.github.com/user', {
      headers: headers(accessToken),
    });
    if (!userResponse.ok) throw failed();
    const profile = (await userResponse.json()) as GitHubUserResponse;

    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: headers(accessToken),
    });
    if (!emailResponse.ok) throw failed();
    const emails = (await emailResponse.json()) as GitHubEmailResponse[];
    const verified = (Array.isArray(emails) ? emails : []).filter((e) => e.verified === true);
    const primaryVerifiedEmail = (verified.find((e) => e.primary) ?? verified[0])?.email
      ?.toLowerCase()
      .trim();

    const scopes = (tokenData.scope ?? '').split(/[,\s]+/).filter(Boolean);
    return { accessToken, scopes, profile, primaryVerifiedEmail };
  }

  /**
   * Connexion par GitHub. Identité = `githubId` (pas l'e-mail). Un e-mail déjà connu sans
   * `githubId` n'est jamais rattaché : 409, la liaison se fait depuis une session (S8, S9).
   */
  async loginWithGitHub(
    code: string,
    oauthState: GithubOAuthState,
    ctx: LoginContext = {},
  ): Promise<LoginResult> {
    verifyGithubOAuthState(oauthState.cookie, oauthState.state, ['login']);
    const { profile, primaryVerifiedEmail } = await this.fetchGitHubIdentity(code);
    const githubId = String(profile.id);

    // Le jeton GitHub de connexion (portée read:user user:email) n'est jamais persisté : il
    // écraserait un jeton `repo` existant (S9-a). Seule la liaison `repos` en stocke un.
    let user = await this.prisma.user.findUnique({ where: { githubId } });
    const existingGithubAccount = Boolean(user);
    if (!user) {
      if (!primaryVerifiedEmail) {
        throw new UnauthorizedException('Une adresse e-mail GitHub vérifiée est requise.');
      }
      const existing = await this.prisma.user.findUnique({
        where: { email: primaryVerifiedEmail },
      });
      if (existing) {
        throw new ConflictException(
          'Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec votre méthode habituelle (ou « Mot de passe oublié » si vous n’avez pas finalisé votre inscription), puis liez votre compte GitHub depuis « Sécurité du compte ».',
        );
      }
      // Aucune création de compte pour un domaine qui impose le SSO : sinon un compte serait
      // créé puis refusé par completeLogin (S10)
      await this.assertSsoNotEnforced(primaryVerifiedEmail);
      user = await this.prisma.user.create({
        data: {
          email: primaryVerifiedEmail,
          name: profile.name || profile.login,
          githubId,
          githubUsername: profile.login,
          // L'adresse est celle que GitHub atteste vérifiée
          emailVerifiedAt: new Date(),
        },
      });
    }

    const result = await this.completeLogin(user, { ...ctx, method: 'github' });
    // Aucune écriture avant les contrôles de completeLogin (suspension, enforceSSO, MFA)
    if (existingGithubAccount && user.githubUsername !== profile.login) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { githubUsername: profile.login },
      });
    }
    return result;
  }

  /**
   * Lie un compte GitHub au compte connecté (liaison explicite, S8/S9). Le jeton n'est conservé
   * que pour la finalité `repos` et si GitHub a bien accordé la portée `repo`. S31 : la
   * réauthentification précède l'échange du code contre un jeton (aucun jeton obtenu ni stocké si
   * elle échoue).
   */
  async linkGitHubAccount(
    userId: string,
    code: string,
    oauthState: GithubOAuthState,
    reauth: IdentityReauthDto = {},
    sid?: string,
  ) {
    const purpose = verifyGithubOAuthState(oauthState.cookie, oauthState.state, ['link', 'repos']);
    const account = await this.loadIdentityAccount(userId);
    await this.assertIdentityReauth(account, reauth, sid);

    const { accessToken, scopes, profile } = await this.fetchGitHubIdentity(code);
    const githubId = String(profile.id);

    const owner = await this.prisma.user.findUnique({ where: { githubId } });
    if (owner && owner.id !== userId) {
      throw new ConflictException('Ce compte GitHub est déjà lié à un autre utilisateur.');
    }
    // Jamais de remplacement silencieux : changer d'identité GitHub exige une déliaison préalable.
    // Rien n'est écrit et le jeton obtenu n'est pas conservé.
    if (account.githubId && account.githubId !== githubId) {
      throw new ConflictException('Déliez d’abord le compte GitHub actuel.');
    }

    const storeToken = purpose === 'repos' && scopes.includes('repo');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        githubId,
        githubUsername: profile.login,
        ...(storeToken ? { githubAccessToken: encrypt(accessToken) } : {}),
      },
    });
    await this.recordIdentityChange(account, 'IDENTITY_LINKED', 'GitHub', profile.login, sid);
    return {
      message: 'Compte GitHub associé avec succès.',
      githubUsername: profile.login,
      repoAccess: storeToken,
    };
  }

  /**
   * Login simulé pour le développement local.
   */
  async mockLogin(name: string, ctx: LoginContext = {}): Promise<LoginResult> {
    // Défense en profondeur : la route n'existe de toute façon que dans ce cas (P13-e)
    if (!isDevAuthEnabled()) {
      throw new BadRequestException("Le mode simulation n'est pas disponible.");
    }

    const sessionId = randomUUID();
    const user = await this.prisma.user.create({
      data: {
        email: `demo-${sessionId}@local.planner.pro`,
        name,
        githubId: `mock-github-id-${sessionId}`,
        githubUsername: name,
      },
    });

    return this.completeLogin(user, { ...ctx, method: 'mock' });
  }

  /**
   * Récupère la liste des dépôts GitHub publics et privés de l'utilisateur.
   */
  async getGitHubRepositories(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.githubAccessToken) {
      throw new BadRequestException('Aucun compte GitHub connecté pour cet utilisateur.');
    }

    const decryptedToken = decrypt(user.githubAccessToken);

    let response: Response;
    try {
      response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: {
          Authorization: `Bearer ${decryptedToken}`,
          'User-Agent': 'Planner-Pro-App',
        },
        signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException('GitHub est injoignable, réessayez plus tard.');
    }

    // Un 401 de cette route ne doit jamais signifier « session Planner-Pro expirée » (P9-R-a) :
    // jeton GitHub invalide -> 403 (le client relance l'autorisation) ; autre échec de GitHub
    // (5xx, limite de débit) -> 503, sans détour d'autorisation.
    if (response.status === 401) {
      throw new ForbiddenException('Jeton GitHub invalide ou révoqué.');
    }
    if (response.status !== 200) {
      throw new ServiceUnavailableException('GitHub est indisponible, réessayez plus tard.');
    }

    const repos = (await response.json()) as GitHubRepoResponse[];
    return repos.map((repo: GitHubRepoResponse) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      url: repo.html_url,
      private: repo.private,
      stars: repo.stargazers_count,
      language: repo.language,
    }));
  }

  /**
   * Associe un dépôt GitHub à un projet Planner-Pro (P9-R). Droit `project.manage` (politique
   * centrale), puis vérification chez GitHub, avec le jeton de l'utilisateur, que le dépôt existe
   * et lui est accessible. Le nom enregistré est le `full_name` canonique renvoyé par GitHub ;
   * aucune écriture si la vérification échoue ou dépasse le délai.
   */
  async syncRepositoryToProject(userId: string, projectId: string, repoFullName: string) {
    await this.policy.assertProject(projectId, userId, 'project.manage');

    if (!GITHUB_REPO_FULL_NAME.test(repoFullName)) {
      throw new BadRequestException('Nom de dépôt invalide.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.githubAccessToken) {
      throw new BadRequestException('Aucun compte GitHub connecté pour cet utilisateur.');
    }

    const [owner, repo] = repoFullName.split('/');
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        {
          headers: {
            Authorization: `Bearer ${decrypt(user.githubAccessToken)}`,
            'User-Agent': 'Planner-Pro-App',
          },
          signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
        },
      );
    } catch {
      throw new ServiceUnavailableException('GitHub est injoignable, réessayez plus tard.');
    }
    if (response.status !== 200) {
      throw new BadRequestException('Dépôt introuvable ou inaccessible avec votre compte GitHub.');
    }
    const canonical = ((await response.json()) as { full_name?: unknown }).full_name;
    if (typeof canonical !== 'string' || !GITHUB_REPO_FULL_NAME.test(canonical)) {
      throw new BadRequestException('Réponse GitHub inattendue.');
    }

    // Secret de webhook (S21) : généré à la première liaison et à chaque changement de dépôt,
    // conservé si le même dépôt est relié de nouveau. Montré une seule fois : jamais relu ensuite.
    const current = await this.prisma.project.findFirst({
      where: { id: projectId },
      omit: { githubWebhookSecret: false },
    });
    const needsSecret =
      !current?.githubWebhookSecret ||
      current.githubRepo?.toLowerCase() !== canonical.toLowerCase();
    const webhookSecret = needsSecret ? generateWebhookSecret() : undefined;

    const saved = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        githubRepo: canonical,
        ...(webhookSecret ? { githubWebhookSecret: encrypt(webhookSecret) } : {}),
      },
    });
    // Le secret chiffré ne quitte jamais le serveur : retiré même si le client Prisma le renvoyait
    const project: Record<string, unknown> = { ...saved };
    delete project.githubWebhookSecret;
    return webhookSecret ? { ...project, webhookSecret } : project;
  }

  /**
   * Envoi d'e-mail détaché de la réponse (P6-b) : la durée d'un aller-retour SMTP ne doit pas
   * révéler si une adresse existe (anti-énumération). Les écritures en base restent dans la
   * requête ; un échec d'envoi est journalisé sans changer la réponse.
   */
  private sendDetached(send: () => Promise<boolean>): void {
    void Promise.resolve()
      .then(send)
      .catch((error: unknown) => {
        this.logger.error(
          `Échec de l'envoi d'un e-mail de compte : ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /** Émet un jeton à usage unique (haché en base) et invalide les précédents du même type. */
  private async issueAuthToken(
    userId: string,
    type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
    ttlMs: number,
  ): Promise<string> {
    await this.prisma.authToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.authToken.create({
      data: { userId, type, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return raw;
  }

  /** Consomme un jeton (type, expiration, usage unique atomique) et renvoie son propriétaire. */
  private async consumeAuthToken(
    raw: string,
    type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
  ): Promise<string> {
    const invalid = new BadRequestException('Lien invalide ou expiré.');
    if (!raw) throw invalid;
    const token = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!token || token.type !== type || token.usedAt || token.expiresAt <= new Date()) {
      throw invalid;
    }
    const consumed = await this.prisma.authToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw invalid;
    return token.userId;
  }

  /**
   * Inscription classique. Réponse générique 202 (identique si l'adresse existe déjà, S27) :
   * le compte n'ouvre AUCUNE session avant la vérification de l'adresse par lien à usage unique
   * valable 24 h (P6). Une adresse déjà utilisée reçoit seulement une notification.
   */
  async register(email: string, passwordRaw: string, name: string): Promise<{ message: string }> {
    if (!email || !passwordRaw || !name) {
      throw new BadRequestException('Tous les champs (email, mot de passe, nom) sont requis.');
    }
    const emailLower = email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { email: emailLower },
    });

    // Même coût de hachage dans les deux branches (pas d'oracle temporel)
    const hashedPassword = await hashPassword(passwordRaw);

    if (existing) {
      this.sendDetached(() => this.mail.sendAccountExistsEmail(emailLower));
      return { message: REGISTER_ACCEPTED_MESSAGE };
    }

    let user;
    try {
      user = await this.prisma.$transaction(async (transaction) => {
        const createdUser = await transaction.user.create({
          data: {
            email: emailLower,
            name: name.trim(),
            passwordHash: hashedPassword,
            emailVerifiedAt: null,
          },
        });

        await this.createOnboardingData(
          transaction,
          createdUser.id,
          createdUser.name || 'Nouvel Utilisateur',
        );

        return createdUser;
      });
    } catch (error) {
      // Inscription concurrente avec la même adresse : traitée comme une adresse déjà utilisée
      if ((error as { code?: string }).code === 'P2002') {
        return { message: REGISTER_ACCEPTED_MESSAGE };
      }
      throw error;
    }

    const rawToken = await this.issueAuthToken(
      user.id,
      'EMAIL_VERIFICATION',
      EMAIL_VERIFICATION_TTL_MS,
    );
    this.sendDetached(() => this.mail.sendEmailVerificationEmail(emailLower, rawToken));
    return { message: REGISTER_ACCEPTED_MESSAGE };
  }

  /** Confirme une adresse e-mail avec le lien reçu (usage unique, 24 h). */
  async verifyEmail(rawToken: string): Promise<{ message: string }> {
    const userId = await this.consumeAuthToken(rawToken, 'EMAIL_VERIFICATION');
    await this.prisma.user.updateMany({
      where: { id: userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
    return { message: 'Adresse e-mail confirmée. Vous pouvez vous connecter.' };
  }

  /** Renvoie le lien de vérification d'un compte non vérifié ; réponse identique sinon. */
  async resendVerification(email: string): Promise<{ message: string }> {
    const emailLower = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email: emailLower } });
    if (user && !user.emailVerifiedAt && user.passwordHash) {
      const rawToken = await this.issueAuthToken(
        user.id,
        'EMAIL_VERIFICATION',
        EMAIL_VERIFICATION_TTL_MS,
      );
      this.sendDetached(() => this.mail.sendEmailVerificationEmail(emailLower, rawToken));
    }
    return { message: VERIFICATION_RESENT_MESSAGE };
  }

  /** Demande de réinitialisation : lien à usage unique de 30 min ; réponse identique si inconnue. */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const emailLower = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email: emailLower } });
    if (user) {
      const rawToken = await this.issueAuthToken(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS);
      this.sendDetached(() => this.mail.sendPasswordResetEmail(emailLower, rawToken));
    }
    return { message: PASSWORD_RESET_REQUESTED_MESSAGE };
  }

  /**
   * Réinitialise le mot de passe. Le lien prouve la propriété de l'adresse (le compte devient
   * vérifié). Toutes les sessions du compte sont révoquées ; le MFA reste actif.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<{ message: string }> {
    const userId = await this.consumeAuthToken(rawToken, 'PASSWORD_RESET');
    const passwordHash = await hashPassword(newPassword);
    // Nouveau mot de passe et preuve de propriété de l'adresse : tout ou rien
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    });
    await this.sessionService.revokeAllForUser(userId);
    return { message: 'Mot de passe modifié. Toutes vos sessions ont été fermées.' };
  }

  /**
   * Connexion classique (Email, Mot de passe)
   */
  async login(email: string, passwordRaw: string, ctx: LoginContext = {}): Promise<LoginResult> {
    if (!email || !passwordRaw) {
      throw new BadRequestException("L'email et le mot de passe sont requis.");
    }
    const emailLower = email.toLowerCase().trim();
    // Compte verrouillé ou trop d'échecs récents : 429 avant tout calcul (S24), existant ou non
    await this.loginLockout.assertAllowed(emailLower);
    const user = await this.prisma.user.findUnique({
      where: { email: emailLower },
    });

    if (!user || !user.passwordHash) {
      // Même coût de vérification que pour un compte existant (pas d'oracle temporel, S27)
      await verifyPassword(passwordRaw, await getDummyPasswordHash());
      await this.loginLockout.recordFailure(emailLower);
      throw new UnauthorizedException('Identifiants invalides.');
    }

    const { isValid, needsMigration } = await verifyPassword(passwordRaw, user.passwordHash);
    if (!isValid) {
      await this.loginLockout.recordFailure(emailLower);
      throw new UnauthorizedException('Identifiants invalides.');
    }
    await this.loginLockout.reset(emailLower);

    // Migration différée (Lazy migration)
    if (needsMigration) {
      const newHash = await hashPassword(passwordRaw);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });
    }

    // Adresse non vérifiée (nouvelle inscription) : refusé APRÈS la vérification du mot de passe,
    // pour ne pas révéler l'existence d'un compte à qui ne le connaît pas (P6, S27)
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(
        'Adresse e-mail non vérifiée. Consultez le lien de confirmation envoyé à votre adresse.',
      );
    }

    // Suspension, enforceSSO et MFA : politique commune de completeLogin (S8)
    return this.completeLogin(user, { ...ctx, method: 'password' });
  }

  /** Un secret TOTP est stocké chiffré ; un secret encore en clair (avant migration) reste lisible. */
  private readMfaSecret(stored: string): string {
    return ENCRYPTED_FORMAT.test(stored) ? decrypt(stored) : stored;
  }

  private generateRecoveryCode(): string {
    let code = '';
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
      code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    return code;
  }

  private normalizeRecoveryCode(input: string): string {
    return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Remplace les codes de récupération d'un compte par 10 nouveaux (hachés en Argon2id).
   * Les codes en clair ne sont renvoyés qu'ici, une seule fois.
   */
  private async replaceRecoveryCodes(
    tx: Pick<Prisma.TransactionClient, 'mfaRecoveryCode'>,
    userId: string,
  ): Promise<string[]> {
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const raw = this.generateRecoveryCode();
      await tx.mfaRecoveryCode.create({ data: { userId, codeHash: await hashPassword(raw) } });
      codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
    }
    return codes;
  }

  /**
   * Accepte un code TOTP une seule fois : le pas de temps doit être strictement supérieur au
   * dernier accepté (anti-rejeu, S6). La mise à jour conditionnelle protège aussi des requêtes
   * concurrentes portant le même code.
   */
  private async consumeTotp(user: { id: string; mfaSecret: string }, code: string) {
    const step = verifyTotpStep(this.readMfaSecret(user.mfaSecret), code);
    if (step === null) return false;
    const updated = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
      },
      data: { mfaLastUsedStep: step },
    });
    return updated.count === 1;
  }

  /** Consomme un code de récupération (usage unique, vérifié contre les codes non utilisés). */
  private async consumeRecoveryCode(userId: string, input: string): Promise<boolean> {
    const normalized = this.normalizeRecoveryCode(input);
    if (normalized.length !== RECOVERY_CODE_LENGTH) return false;
    const candidates = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
    });
    for (const candidate of candidates) {
      const { isValid } = await verifyPassword(normalized, candidate.codeHash);
      if (!isValid) continue;
      const used = await this.prisma.mfaRecoveryCode.updateMany({
        where: { id: candidate.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return used.count === 1;
    }
    return false;
  }

  /** Facteur actuel prouvé par un code TOTP ou un code de récupération. */
  private async verifyCurrentFactor(
    user: { id: string; mfaSecret: string },
    input: { code?: string; recoveryCode?: string },
  ): Promise<void> {
    let valid: boolean;
    if (input.code) {
      valid = await this.consumeTotp(user, input.code);
    } else if (input.recoveryCode) {
      valid = await this.consumeRecoveryCode(user.id, input.recoveryCode);
    } else {
      throw new BadRequestException('Un code TOTP ou un code de récupération est requis.');
    }
    if (!valid) {
      throw new BadRequestException('Code invalide.');
    }
  }

  /**
   * Réauthentification avant une opération sensible sur le MFA (S6) : mot de passe pour les
   * comptes qui en ont un ; sinon connexion de moins de 5 minutes.
   */
  private async assertReauthenticated(
    user: { id: string; passwordHash: string | null },
    password: string | undefined,
    sid: string | undefined,
  ): Promise<void> {
    if (user.passwordHash) {
      if (!password) {
        throw new ForbiddenException('Le mot de passe est requis pour cette action.');
      }
      const { isValid } = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        throw new ForbiddenException('Mot de passe incorrect.');
      }
      return;
    }
    const authenticatedAt = sid ? await this.sessionService.getAuthenticatedAt(sid, user.id) : null;
    if (!authenticatedAt || Date.now() - authenticatedAt.getTime() > REAUTH_MAX_AGE_MS) {
      throw new ForbiddenException(
        'Reconnectez-vous pour effectuer cette action (authentification récente requise).',
      );
    }
  }

  /**
   * Le compte peut-il encore se connecter par SSO ? Oui s'il porte un `ssoUid` et si une
   * configuration SSO **active** (`enabled`) au domaine **prouvé** (`domainVerifiedAt`) existe pour
   * le domaine de son adresse : mêmes critères que `SsoService.findUsableConfig` (S10-a).
   */
  private async hasActiveSso(account: { email: string; ssoUid: string | null }): Promise<boolean> {
    if (!account.ssoUid) return false;
    const domain = account.email.toLowerCase().trim().split('@')[1];
    if (!domain) return false;
    const config = await this.prisma.sSOConfiguration.findUnique({
      where: { verifiedDomain: domain },
    });
    return Boolean(config && config.enabled && config.domainVerifiedAt);
  }

  /** Compte et champs nécessaires à la réauthentification et à la protection de la dernière méthode. */
  private async loadIdentityAccount(userId: string) {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        mfaEnabled: true,
        mfaSecret: true,
        firebaseUid: true,
        firebaseEmail: true,
        githubId: true,
        githubUsername: true,
        ssoUid: true,
      },
    });
    if (!account) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }
    return account;
  }

  /**
   * S31 : lier ou délier une identité exige la preuve récente de l'identité (mot de passe, ou
   * connexion de moins de 5 minutes) et, si la MFA est active, un code TOTP ou de secours (pas de
   * temps consommé). Toujours appelée avant la moindre écriture.
   */
  private async assertIdentityReauth(
    account: Awaited<ReturnType<AuthService['loadIdentityAccount']>>,
    reauth: IdentityReauthDto,
    sid: string | undefined,
  ): Promise<void> {
    await this.assertReauthenticated(account, reauth.password, sid);
    if (account.mfaEnabled && account.mfaSecret) {
      await this.verifyCurrentFactor(
        { id: account.id, mfaSecret: account.mfaSecret },
        { code: reauth.mfaCode, recoveryCode: reauth.recoveryCode },
      );
    }
  }

  /** Audit et notification d'une liaison ou déliaison (aucun secret). La notification est au mieux. */
  private async recordIdentityChange(
    account: { id: string; email: string },
    action: 'IDENTITY_LINKED' | 'IDENTITY_UNLINKED',
    provider: 'Firebase' | 'GitHub',
    identifier: string,
    sid: string | undefined,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: account.id,
        action,
        entityType: 'User',
        entityId: account.id,
        changes: { provider, identifier, sid: sid ?? null },
      },
    });
    const details = { provider, identifier, at: new Date() };
    try {
      if (action === 'IDENTITY_LINKED') {
        await this.mail.sendIdentityLinkedEmail(account.email, details);
      } else {
        await this.mail.sendIdentityUnlinkedEmail(account.email, details);
      }
    } catch {
      // L'échec d'envoi ne doit pas annuler une opération déjà réalisée
    }
  }

  /**
   * Ferme les autres sessions du compte (P9-S) et journalise le nombre de sessions fermées et le
   * `sid` courant (aucun jeton).
   */
  async revokeOtherSessions(userId: string, sid: string | undefined): Promise<{ revoked: number }> {
    const revoked = await this.sessionService.revokeAllForUser(userId, sid);
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'SESSIONS_REVOKED',
        entityType: 'User',
        entityId: userId,
        changes: { count: revoked, sid: sid ?? null },
      },
    });
    return { revoked };
  }

  /**
   * Délie l'identité Firebase ou GitHub (S31). Même réauthentification que la liaison ; refus
   * (409) si c'est la dernière méthode de connexion ; les autres sessions sont révoquées et le
   * jeton GitHub effacé.
   */
  async unlinkIdentity(
    userId: string,
    provider: 'firebase' | 'github',
    reauth: IdentityReauthDto,
    sid?: string,
  ) {
    const account = await this.loadIdentityAccount(userId);
    await this.assertIdentityReauth(account, reauth, sid);

    const linked = provider === 'firebase' ? account.firebaseUid : account.githubId;
    if (!linked) {
      throw new ConflictException(
        `Aucun compte ${provider === 'firebase' ? 'Firebase' : 'GitHub'} n'est lié.`,
      );
    }
    const ssoActive = await this.hasActiveSso(account);
    if (!hasOtherLoginMethod(account, provider, ssoActive)) {
      throw new ConflictException(
        'Impossible de retirer la dernière méthode de connexion : définissez un mot de passe ou liez une autre identité.',
      );
    }

    // Écriture conditionnelle (S31-a) : le contrôle ci-dessus porte sur une lecture, donc deux
    // déliaisons simultanées pourraient retirer chacune « l'autre » méthode. La condition est
    // réévaluée par la base au moment de l'écriture ; si elle n'est plus vraie, rien n'est écrit.
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: userId,
        ...(provider === 'firebase' ? { firebaseUid: { not: null } } : { githubId: { not: null } }),
        OR: [
          { passwordHash: { not: null } },
          // Miroir de `ssoActive` (évalué à la lecture ci-dessus) : sans SSO utilisable, le
          // `ssoUid` n'est pas une méthode de connexion
          ...(ssoActive ? [{ ssoUid: { not: null } }] : []),
          provider === 'firebase' ? { githubId: { not: null } } : { firebaseUid: { not: null } },
        ],
      },
      data:
        provider === 'firebase'
          ? { firebaseUid: null, firebaseEmail: null }
          : { githubId: null, githubUsername: null, githubAccessToken: null },
    });
    if (count === 0) {
      throw new ConflictException(
        'Impossible de retirer la dernière méthode de connexion : une autre modification du compte vient d’avoir lieu. Réessayez.',
      );
    }
    await this.sessionService.revokeAllForUser(userId, sid);
    await this.recordIdentityChange(
      account,
      'IDENTITY_UNLINKED',
      provider === 'firebase' ? 'Firebase' : 'GitHub',
      (provider === 'firebase' ? account.firebaseEmail : account.githubUsername) ?? 'inconnu',
      sid,
    );
  }

  /** Identités liées du compte connecté, pour l'écran « Sécurité du compte » (S31, point 5). */
  async getIdentities(userId: string) {
    const account = await this.loadIdentityAccount(userId);
    const ssoActive = await this.hasActiveSso(account);
    return {
      firebase: { linked: Boolean(account.firebaseUid), email: account.firebaseEmail },
      github: { linked: Boolean(account.githubId), username: account.githubUsername },
      hasPassword: Boolean(account.passwordHash),
      mfaEnabled: account.mfaEnabled,
      // Règle unique, partagée avec la déliaison : le client ne la recalcule pas (P9-L-a)
      canUnlink: {
        firebase:
          Boolean(account.firebaseUid) && hasOtherLoginMethod(account, 'firebase', ssoActive),
        github: Boolean(account.githubId) && hasOtherLoginMethod(account, 'github', ssoActive),
      },
    };
  }

  /** État MFA du compte pour l'écran « Sécurité du compte » (P9). Jamais de secret. */
  async getMfaStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, passwordHash: true },
    });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }
    return { mfaEnabled: user.mfaEnabled, hasPassword: Boolean(user.passwordHash) };
  }

  /**
   * Initialise la configuration MFA TOTP. Refusé (409) si le MFA est déjà actif : changer de
   * facteur passe d'abord par la désactivation (code + mot de passe). Le secret reste « en
   * attente », chiffré, tant que l'utilisateur n'a pas prouvé qu'il le possède.
   */
  async setupMfa(userId: string, dto: SetupMfaDto = {}, sid?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }
    // Une session volée ne doit pas pouvoir enrôler le facteur de l'attaquant (S6-b)
    await this.assertReauthenticated(user, dto.password, sid);
    if (user.mfaEnabled) {
      throw new ConflictException(
        'Le MFA est déjà activé. Désactivez-le (code et mot de passe) avant de le reconfigurer.',
      );
    }

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaPendingSecret: encrypt(secret) },
    });

    return { secret, authUri: getTotpAuthUri(user.email, secret) };
  }

  /**
   * Confirme l'activation : le secret en attente est promu, le pas de temps utilisé est consommé
   * et 10 codes de récupération sont livrés (une seule fois).
   */
  async confirmMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }
    if (user.mfaEnabled) {
      throw new ConflictException('Le MFA est déjà activé.');
    }
    if (!user.mfaPendingSecret) {
      throw new BadRequestException('Aucune configuration MFA en attente.');
    }

    const step = verifyTotpStep(this.readMfaSecret(user.mfaPendingSecret), code);
    if (step === null) {
      throw new BadRequestException('Code TOTP à 6 chiffres invalide.');
    }

    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaSecret: ENCRYPTED_FORMAT.test(user.mfaPendingSecret as string)
            ? user.mfaPendingSecret
            : encrypt(user.mfaPendingSecret as string),
          mfaPendingSecret: null,
          mfaEnabled: true,
          mfaLastUsedStep: step,
        },
      });
      return this.replaceRecoveryCodes(tx, userId);
    });

    return {
      mfaEnabled: true,
      recoveryCodes,
      message:
        'Authentification multifacteur activée. Conservez ces codes de récupération : ils ne seront plus affichés.',
    };
  }

  /**
   * Désactive le MFA : facteur actuel (TOTP ou code de récupération) ET mot de passe (ou
   * connexion récente). Les autres sessions du compte sont révoquées.
   */
  async disableMfa(userId: string, dto: DisableMfaDto, sid?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new BadRequestException("Le MFA n'est pas activé sur ce compte.");
    }

    await this.assertReauthenticated(user, dto.password, sid);
    await this.verifyCurrentFactor({ id: user.id, mfaSecret: user.mfaSecret }, dto);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaPendingSecret: null,
          mfaLastUsedStep: null,
        },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    });
    await this.sessionService.revokeAllForUser(userId, sid);

    return { mfaEnabled: false, message: 'Authentification multifacteur désactivée.' };
  }

  /** Nouveaux codes de récupération : code TOTP ET mot de passe, les anciens sont invalidés. */
  async regenerateRecoveryCodes(userId: string, dto: RegenerateRecoveryCodesDto, sid?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new BadRequestException("Le MFA n'est pas activé sur ce compte.");
    }

    await this.assertReauthenticated(user, dto.password, sid);
    await this.verifyCurrentFactor({ id: user.id, mfaSecret: user.mfaSecret }, { code: dto.code });

    const recoveryCodes = await this.prisma.$transaction((tx) =>
      this.replaceRecoveryCodes(tx, userId),
    );
    return { recoveryCodes };
  }

  /**
   * Exécute un appel Redis du parcours MFA avec un délai maximal (S3). Le client ioredis met les
   * commandes en file sans limite pendant une reconnexion : sans ce délai, la requête resterait
   * bloquée. En cas d'erreur ou de dépassement, 503 et aucun jeton ni ticket n'est émis.
   */
  private async withRedisTimeout<T>(operation: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Délai Redis dépassé')), this.redisTimeoutMs);
    });
    try {
      return await Promise.race([operation(), timeout]);
    } catch {
      throw new ServiceUnavailableException(
        'Validation MFA momentanément indisponible, réessayez.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private mfaTicketKey(jti: string): string {
    return `mfa_ticket:${jti}`;
  }

  /**
   * Valide le challenge MFA lors de la connexion pour émettre le jeton final
   */
  async verifyMfaChallenge(
    mfaTicket: string,
    input: { code?: string; recoveryCode?: string },
    ctx: LoginContext = {},
  ): Promise<SessionLoginResult> {
    if (!mfaTicket || (!input.code && !input.recoveryCode)) {
      throw new BadRequestException(
        'Le ticket MFA et un code à 6 chiffres (ou un code de récupération) sont requis.',
      );
    }

    const payload = await this.tokenService.verifyMfaTicket(mfaTicket);

    // Ticket à usage unique : absent de Redis s'il a déjà servi ou a été invalidé
    const ticketKey = this.mfaTicketKey(payload.jti);
    const ticketRecord = await this.withRedisTimeout(() => this.redis.get(ticketKey));
    // Valeur « <userId>|<méthode d'origine> » (S8) ; l'ancien format sans méthode reste accepté
    const [ticketOwner, ticketMethod] = (ticketRecord ?? '').split('|');
    const primaryMethod = (ticketMethod as LoginMethod | undefined) || 'password';
    if (ticketOwner !== payload.sub) {
      throw new UnauthorizedException(
        'Session de validation MFA expirée. Veuillez vous reconnecter.',
      );
    }

    // Limite par compte, tous tickets confondus : un attaquant qui connaît le mot de passe obtient
    // autant de tickets qu'il veut, chacun limité à 5 essais (S24)
    await this.mfaLockout.assertAllowed(payload.sub);

    // Limite d'essais par ticket : au-delà, le ticket est invalidé
    const attempts = await this.withRedisTimeout(() =>
      this.redis.incrementWithTtl(`${ticketKey}:attempts`, MFA_TICKET_TTL_SECONDS),
    );
    if (attempts > MFA_TICKET_MAX_ATTEMPTS) {
      await this.withRedisTimeout(() => this.redis.del(ticketKey));
      throw new UnauthorizedException(
        'Trop de tentatives de validation MFA. Veuillez vous reconnecter.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.mfaSecret || !user.mfaEnabled) {
      throw new UnauthorizedException('Configuration MFA introuvable.');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('Ce compte utilisateur est suspendu.');
    }

    // Code TOTP (anti-rejeu) ou code de récupération à usage unique (S6)
    const isValid = input.code
      ? await this.consumeTotp({ id: user.id, mfaSecret: user.mfaSecret }, input.code)
      : await this.consumeRecoveryCode(user.id, input.recoveryCode as string);
    if (!isValid) {
      await this.mfaLockout.recordFailure(payload.sub);
      if (attempts >= MFA_TICKET_MAX_ATTEMPTS) {
        await this.withRedisTimeout(() => this.redis.del(ticketKey));
      }
      throw new UnauthorizedException('Code de vérification TOTP incorrect.');
    }
    await this.mfaLockout.reset(payload.sub);

    // Consommation atomique : une seule requête concurrente peut utiliser le ticket
    if ((await this.withRedisTimeout(() => this.redis.del(ticketKey))) !== 1) {
      throw new UnauthorizedException(
        'Session de validation MFA expirée. Veuillez vous reconnecter.',
      );
    }

    return this.completeLogin(user, { ...ctx, method: 'mfa', primaryMethod });
  }

  /**
   * Crée des données de démonstration pour guider le nouvel utilisateur.
   */
  private async createOnboardingData(
    transaction: Prisma.TransactionClient,
    userId: string,
    name: string,
  ) {
    // 1. Créer un Workspace par défaut
    const workspace = await transaction.workspace.create({
      data: {
        name: `Espace de ${name}`,
        ownerId: userId,
      },
    });

    // Ajouter la relation de membre (Membership)
    await transaction.membership.create({
      data: {
        workspaceId: workspace.id,
        userId: userId,
        role: 'OWNER',
      },
    });

    // 2. Créer un projet d'onboarding
    const project = await transaction.project.create({
      data: {
        name: '🚀 Démarrage Planner-Pro',
        description:
          "Projet d'apprentissage interactif pour maîtriser toutes les fonctionnalités de Planner-Pro.",
        status: 'ACTIVE',
        userId: userId,
        workspaceId: workspace.id,
      },
    });

    // 3. Créer des tâches de démonstration
    const task1 = await transaction.task.create({
      data: {
        title: '📖 Découvrir le Kanban',
        description:
          'Déplacez cette tâche de "À faire" à "En cours". Vous pouvez changer son statut, sa priorité et y ajouter des commentaires.',
        status: 'TODO',
        priority: 'LOW',
        projectId: project.id,
        userId: userId,
      },
    });

    await transaction.task.create({
      data: {
        title: '⏱️ Lancer un timer Pomodoro',
        description:
          "Allez sur l'onglet Pomodoro, sélectionnez cette tâche, puis lancez le timer de 25 min pour tracker votre temps de focus.",
        status: 'TODO',
        priority: 'MEDIUM',
        projectId: project.id,
        userId: userId,
      },
    });

    await transaction.task.create({
      data: {
        title: "🤖 Poser une question à l'Assistant IA",
        description:
          "Cliquez sur l'icône Sparkles ou tapez ⌘+K pour ouvrir la barre de commande IA. Tapez \"Briefing de mon projet\" pour voir l'IA à l'œuvre.",
        status: 'TODO',
        priority: 'HIGH',
        projectId: project.id,
        userId: userId,
      },
    });

    const task4 = await transaction.task.create({
      data: {
        title: '📊 Voir le chemin critique sur Gantt',
        description:
          'Consultez l\'onglet Gantt. Vous y verrez cette tâche qui dépend de la première tâche ("Découvrir le Kanban"). Le chemin critique est affiché en rouge.',
        status: 'TODO',
        priority: 'HIGH',
        projectId: project.id,
        userId: userId,
      },
    });

    // Créer la dépendance
    await transaction.taskDependency.create({
      data: {
        taskId: task4.id,
        dependsOnTaskId: task1.id,
        type: 'FINISH_TO_START',
      },
    });
  }
}
