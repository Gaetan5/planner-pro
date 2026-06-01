import { Controller, Post, Get, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Endpoint de login OAuth GitHub
   */
  @Post('github/login')
  loginWithGitHub(@Body() body: { code: string }) {
    return this.authService.loginWithGitHub(body.code);
  }

  /**
   * Endpoint d'inscription classique
   */
  @Post('register')
  register(@Body() body: { email: string; passwordRaw: string; name: string }) {
    return this.authService.register(body.email, body.passwordRaw, body.name);
  }

  /**
   * Endpoint de login classique
   */
  @Post('login')
  login(@Body() body: { email: string; passwordRaw: string }) {
    return this.authService.login(body.email, body.passwordRaw);
  }

  /**
   * Endpoint de login simulé pour le développement local
   */
  @Post('mock/login')
  mockLogin(@Body() body: { name: string }) {
    return this.authService.mockLogin(body.name);
  }


  /**
   * Récupère les dépôts GitHub de l'utilisateur connecté
   */
  @Get('github/repos')
  @UseGuards(JwtAuthGuard)
  getGitHubRepositories(@Req() req: any) {
    const userId = req.user.id;
    return this.authService.getGitHubRepositories(userId);
  }

  /**
   * Synchronise un dépôt GitHub à un projet Planner-Pro
   */
  @Post('github/sync')
  @UseGuards(JwtAuthGuard)
  syncRepository(
    @Body() body: { projectId: string; repoFullName: string },
    @Req() req: any,
  ) {
    const userId = req.user.id;
    return this.authService.syncRepositoryToProject(userId, body.projectId, body.repoFullName);
  }
}
