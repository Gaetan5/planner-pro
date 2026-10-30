import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { encrypt, decrypt, hashPassword, verifyPassword } from './encryption.util';
import { FirebaseIdentityService } from './firebase-identity.service';
import { generateTotpSecret, verifyTotpCode, getTotpAuthUri } from './totp.util';
import { TokenService, MFA_TICKET_TTL_SECONDS } from './token.service';
import { RedisService } from '../redis/redis.service';

/** Nombre maximal d'essais de code par ticket MFA (S3). */
const MFA_TICKET_MAX_ATTEMPTS = 5;
/** Délai maximal d'un appel Redis du parcours MFA : au-delà, 503 plutôt qu'une requête bloquée. */
const MFA_REDIS_TIMEOUT_MS = 2000;

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly firebaseIdentity: FirebaseIdentityService,
    private readonly redis: RedisService,
  ) {}

  async loginWithFirebase(idToken: string, suppliedName?: string) {
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

      if (existingUser?.firebaseUid) {
        throw new ConflictException('Cet e-mail est déjà associé à un autre compte Firebase.');
      }

      if (existingUser) {
        user = await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            firebaseUid: identity.uid,
            name: existingUser.name || identity.name || suppliedName || email.split('@')[0],
          },
        });
      } else {
        const name = identity.name || suppliedName?.trim() || email.split('@')[0];
        user = await this.prisma.$transaction(async (transaction) => {
          const createdUser = await transaction.user.create({
            data: { email, name, firebaseUid: identity.uid },
          });
          await this.createOnboardingData(transaction, createdUser.id, name);
          return createdUser;
        });
      }
    }

    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
      },
      accessToken,
    };
  }

  /**
   * Associe de manière vérifiée un UID Firebase à un compte utilisateur existant.
   * Valide l'e-mail vérifié et prévient les collisions d'identités.
   */
  async linkFirebaseAccount(userId: string, idToken: string) {
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

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { firebaseUid: identity.uid },
      select: {
        id: true,
        email: true,
        name: true,
        firebaseUid: true,
        platformRole: true,
      },
    });

    return {
      message: 'Compte Firebase associé avec succès.',
      user: updated,
    };
  }

  /**
   * Échange le code d'autorisation GitHub contre un token d'accès,
   * récupère le profil utilisateur GitHub, crée ou met à jour l'utilisateur
   * en base de données et renvoie un JWT.
   */
  async loginWithGitHub(code: string) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'Les clés GITHUB_CLIENT_ID et GITHUB_CLIENT_SECRET ne sont pas configurées.',
      );
    }

    // 1. Échanger le code contre un token d'accès
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = (await tokenResponse.json()) as GitHubTokenResponse;
    if (tokenData.error) {
      throw new UnauthorizedException(
        `Échec OAuth GitHub : ${tokenData.error_description || tokenData.error}`,
      );
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new UnauthorizedException("Jeton d'accès GitHub non fourni.");
    }

    // 2. Récupérer le profil utilisateur GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Planner-Pro-App',
      },
    });
    const userData = (await userResponse.json()) as GitHubUserResponse;

    // 3. Récupérer l'adresse e-mail (si elle n'est pas publique)
    let email = userData.email;
    if (!email) {
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'Planner-Pro-App',
        },
      });
      const emails = (await emailResponse.json()) as GitHubEmailResponse[];
      const primaryEmail = emails?.find((e: GitHubEmailResponse) => e.primary);
      email = primaryEmail ? primaryEmail.email : `${userData.login}@github.planner.pro`;
    }

    // 4. Enregistrer ou mettre à jour l'utilisateur en base de données
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        name: userData.name || userData.login,
        githubId: userData.id.toString(),
        githubUsername: userData.login,
        githubAccessToken: encrypt(accessToken),
      },
      create: {
        email,
        name: userData.name || userData.login,
        githubId: userData.id.toString(),
        githubUsername: userData.login,
        githubAccessToken: encrypt(accessToken),
      },
    });

    // 5. Générer le JWT d'accès
    const payload = { sub: user.id, email: user.email, name: user.name };
    const jwt = this.tokenService.signAccessToken(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
      },
      accessToken: jwt,
    };
  }

  /**
   * Login simulé pour le développement local.
   */
  async mockLogin(name: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException("Le mode simulation n'est pas disponible en production.");
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

    const payload = { sub: user.id, email: user.email, name: user.name };
    const jwt = this.tokenService.signAccessToken(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
      },
      accessToken: jwt,
    };
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

    const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        Authorization: `Bearer ${decryptedToken}`,
        'User-Agent': 'Planner-Pro-App',
      },
    });

    if (!response.ok) {
      throw new UnauthorizedException(
        "Impossible de récupérer les dépôts GitHub. Le jeton d'accès a peut-être expiré.",
      );
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
   * Associe un dépôt GitHub à un projet Planner-Pro.
   */
  async syncRepositoryToProject(userId: string, projectId: string, repoFullName: string) {
    // Vérifier si le projet appartient à l'utilisateur
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new BadRequestException("Projet introuvable ou vous n'avez pas les droits d'accès.");
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        githubRepo: repoFullName,
      },
    });
  }

  /**
   * Inscription classique (Email, Mot de passe, Nom)
   */
  async register(email: string, passwordRaw: string, name: string) {
    if (!email || !passwordRaw || !name) {
      throw new BadRequestException('Tous les champs (email, mot de passe, nom) sont requis.');
    }
    const emailLower = email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { email: emailLower },
    });

    if (existing) {
      throw new BadRequestException('Cet e-mail est déjà utilisé.');
    }

    const hashedPassword = await hashPassword(passwordRaw);

    const user = await this.prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.user.create({
        data: {
          email: emailLower,
          name: name.trim(),
          passwordHash: hashedPassword,
        },
      });

      await this.createOnboardingData(
        transaction,
        createdUser.id,
        createdUser.name || 'Nouvel Utilisateur',
      );

      return createdUser;
    });

    const payload = { sub: user.id, email: user.email, name: user.name };
    const jwt = this.tokenService.signAccessToken(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
      },
      accessToken: jwt,
    };
  }

  /**
   * Connexion classique (Email, Mot de passe)
   */
  async login(email: string, passwordRaw: string) {
    if (!email || !passwordRaw) {
      throw new BadRequestException("L'email et le mot de passe sont requis.");
    }
    const emailLower = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: emailLower },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    const { isValid, needsMigration } = await verifyPassword(passwordRaw, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Migration différée (Lazy migration)
    if (needsMigration) {
      const newHash = await hashPassword(passwordRaw);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });
    }

    if (user.isSuspended) {
      throw new ForbiddenException(
        "Ce compte utilisateur est suspendu. Veuillez contacter l'administrateur.",
      );
    }

    // Si le MFA TOTP est activé, émettre un ticket temporaire au lieu du token final
    if (user.mfaEnabled) {
      // Ticket dédié (typ 'mfa_ticket', clé distincte), enregistré pour un usage unique (S3)
      const { ticket: mfaTicket, jti } = this.tokenService.signMfaTicket(user.id);
      await this.withRedisTimeout(() =>
        this.redis.set(this.mfaTicketKey(jti), user.id, MFA_TICKET_TTL_SECONDS),
      );
      return {
        mfaRequired: true,
        mfaTicket,
        user: {
          id: user.id,
          email: user.email,
        },
      };
    }

    const payload = { sub: user.id, email: user.email, name: user.name };
    const jwt = this.tokenService.signAccessToken(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
      },
      accessToken: jwt,
    };
  }

  /**
   * Initialise la configuration MFA TOTP (génère le secret et l'URI pour l'authenticator)
   */
  async setupMfa(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret },
    });

    const authUri = getTotpAuthUri(user.email, secret);
    return {
      secret,
      authUri,
    };
  }

  /**
   * Confirme et active le MFA après validation d'un premier code TOTP valide
   */
  async confirmMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) {
      throw new BadRequestException('Aucune configuration MFA en attente.');
    }

    const isValid = verifyTotpCode(user.mfaSecret, code);
    if (!isValid) {
      throw new BadRequestException('Code TOTP à 6 chiffres invalide.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    return { mfaEnabled: true, message: 'Authentification multifacteur activée avec succès.' };
  }

  /**
   * Désactive le MFA après vérification du code TOTP
   */
  async disableMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new BadRequestException("Le MFA n'est pas activé sur ce compte.");
    }

    const isValid = verifyTotpCode(user.mfaSecret, code);
    if (!isValid) {
      throw new BadRequestException('Code TOTP invalide.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });

    return { mfaEnabled: false, message: 'Authentification multifacteur désactivée.' };
  }

  /**
   * Exécute un appel Redis du parcours MFA avec un délai maximal (S3). Le client ioredis met les
   * commandes en file sans limite pendant une reconnexion : sans ce délai, la requête resterait
   * bloquée. En cas d'erreur ou de dépassement, 503 et aucun jeton ni ticket n'est émis.
   */
  private async withRedisTimeout<T>(operation: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Délai Redis dépassé')), MFA_REDIS_TIMEOUT_MS);
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
  async verifyMfaChallenge(mfaTicket: string, code: string) {
    if (!mfaTicket || !code) {
      throw new BadRequestException('Le ticket MFA et le code à 6 chiffres sont requis.');
    }

    const payload = await this.tokenService.verifyMfaTicket(mfaTicket);

    // Ticket à usage unique : absent de Redis s'il a déjà servi ou a été invalidé
    const ticketKey = this.mfaTicketKey(payload.jti);
    const ticketOwner = await this.withRedisTimeout(() => this.redis.get(ticketKey));
    if (ticketOwner !== payload.sub) {
      throw new UnauthorizedException(
        'Session de validation MFA expirée. Veuillez vous reconnecter.',
      );
    }

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

    const isValid = verifyTotpCode(user.mfaSecret, code);
    if (!isValid) {
      if (attempts >= MFA_TICKET_MAX_ATTEMPTS) {
        await this.withRedisTimeout(() => this.redis.del(ticketKey));
      }
      throw new UnauthorizedException('Code de vérification TOTP incorrect.');
    }

    // Consommation atomique : une seule requête concurrente peut utiliser le ticket
    if ((await this.withRedisTimeout(() => this.redis.del(ticketKey))) !== 1) {
      throw new UnauthorizedException(
        'Session de validation MFA expirée. Veuillez vous reconnecter.',
      );
    }

    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
      },
      accessToken,
    };
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
