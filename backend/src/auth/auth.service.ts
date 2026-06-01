import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt, hashPassword, verifyPassword } from './encryption.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Échange le code d'autorisation GitHub contre un token d'accès,
   * récupère le profil utilisateur GitHub, crée ou met à jour l'utilisateur
   * en base de données et renvoie un JWT.
   */
  async loginWithGitHub(code: string) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new BadRequestException('Les clés GITHUB_CLIENT_ID et GITHUB_CLIENT_SECRET ne sont pas configurées.');
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

    const tokenData = await tokenResponse.json() as any;
    if (tokenData.error) {
      throw new UnauthorizedException(`Échec OAuth GitHub : ${tokenData.error_description || tokenData.error}`);
    }

    const accessToken = tokenData.access_token;

    // 2. Récupérer le profil utilisateur GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Planner-Pro-App',
      },
    });
    const userData = await userResponse.json() as any;

    // 3. Récupérer l'adresse e-mail (si elle n'est pas publique)
    let email = userData.email;
    if (!email) {
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'Planner-Pro-App',
        },
      });
      const emails = await emailResponse.json() as any[];
      const primaryEmail = emails?.find((e: any) => e.primary);
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
    const jwt = this.jwtService.sign(payload);

    return {
      user,
      accessToken: jwt,
    };
  }

  /**
   * Login simulé pour le développement local.
   */
  async mockLogin(name: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Le mode simulation n\'est pas disponible en production.');
    }

    const email = `${name.toLowerCase().replace(/\s+/g, '')}@local.planner.pro`;
    const mockGithubId = `mock-github-id-${name.toLowerCase().replace(/\s+/g, '')}`;
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        name,
        githubId: mockGithubId,
        githubUsername: name,
      },
      create: {
        email,
        name,
        githubId: mockGithubId,
        githubUsername: name,
      },
    });

    const payload = { sub: user.id, email: user.email, name: user.name };
    const jwt = this.jwtService.sign(payload);

    return {
      user,
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
      throw new UnauthorizedException('Impossible de récupérer les dépôts GitHub. Le jeton d\'accès a peut-être expiré.');
    }

    const repos = await response.json() as any[];
    return repos.map((repo: any) => ({
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
      throw new BadRequestException('Projet introuvable ou vous n\'avez pas les droits d\'accès.');
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
    const emailLower = email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { email: emailLower },
    });

    if (existing) {
      throw new BadRequestException('Cet e-mail est déjà utilisé.');
    }

    const hashedPassword = hashPassword(passwordRaw);

    const user = await this.prisma.user.create({
      data: {
        email: emailLower,
        name: name.trim(),
        passwordHash: hashedPassword,
      },
    });

    // Création des données d'onboarding par défaut
    try {
      await this.createOnboardingData(user.id, user.name || 'Nouvel Utilisateur');
    } catch (err) {
      console.error("Erreur lors de la création des données d'onboarding :", err);
    }

    const payload = { sub: user.id, email: user.email, name: user.name };
    const jwt = this.jwtService.sign(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      accessToken: jwt,
    };
  }

  /**
   * Connexion classique (Email, Mot de passe)
   */
  async login(email: string, passwordRaw: string) {
    const emailLower = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: emailLower },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    const isValid = verifyPassword(passwordRaw, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    const payload = { sub: user.id, email: user.email, name: user.name };
    const jwt = this.jwtService.sign(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      accessToken: jwt,
    };
  }

  /**
   * Crée des données de démonstration pour guider le nouvel utilisateur.
   */
  private async createOnboardingData(userId: string, name: string) {
    // 1. Créer un Workspace par défaut
    const workspace = await this.prisma.workspace.create({
      data: {
        name: `Espace de ${name}`,
        ownerId: userId,
      },
    });

    // Ajouter la relation de membre (Membership)
    await this.prisma.membership.create({
      data: {
        workspaceId: workspace.id,
        userId: userId,
        role: 'OWNER',
      },
    });

    // 2. Créer un projet d'onboarding
    const project = await this.prisma.project.create({
      data: {
        name: '🚀 Démarrage Planner-Pro',
        description: 'Projet d\'apprentissage interactif pour maîtriser toutes les fonctionnalités de Planner-Pro.',
        status: 'ACTIVE',
        userId: userId,
        workspaceId: workspace.id,
      },
    });

    // 3. Créer des tâches de démonstration
    const task1 = await this.prisma.task.create({
      data: {
        title: '📖 Découvrir le Kanban',
        description: 'Déplacez cette tâche de "À faire" à "En cours". Vous pouvez changer son statut, sa priorité et y ajouter des commentaires.',
        status: 'TODO',
        priority: 'LOW',
        projectId: project.id,
        userId: userId,
      },
    });

    const task2 = await this.prisma.task.create({
      data: {
        title: '⏱️ Lancer un timer Pomodoro',
        description: 'Allez sur l\'onglet Pomodoro, sélectionnez cette tâche, puis lancez le timer de 25 min pour tracker votre temps de focus.',
        status: 'TODO',
        priority: 'MEDIUM',
        projectId: project.id,
        userId: userId,
      },
    });

    const task3 = await this.prisma.task.create({
      data: {
        title: '🤖 Poser une question à l\'Assistant IA',
        description: 'Cliquez sur l\'icône Sparkles ou tapez ⌘+K pour ouvrir la barre de commande IA. Tapez "Briefing de mon projet" pour voir l\'IA à l\'œuvre.',
        status: 'TODO',
        priority: 'HIGH',
        projectId: project.id,
        userId: userId,
      },
    });

    const task4 = await this.prisma.task.create({
      data: {
        title: '📊 Voir le chemin critique sur Gantt',
        description: 'Consultez l\'onglet Gantt. Vous y verrez cette tâche qui dépend de la première tâche ("Découvrir le Kanban"). Le chemin critique est affiché en rouge.',
        status: 'TODO',
        priority: 'HIGH',
        projectId: project.id,
        userId: userId,
      },
    });

    // Créer la dépendance
    await this.prisma.taskDependency.create({
      data: {
        taskId: task4.id,
        dependsOnTaskId: task1.id,
        type: 'FINISH_TO_START',
      },
    });
  }
}

