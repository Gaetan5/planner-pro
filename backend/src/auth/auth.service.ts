import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from './encryption.util';

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
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        name,
        githubId: 'mock-github-id',
        githubUsername: name,
      },
      create: {
        email,
        name,
        githubId: 'mock-github-id',
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
}
