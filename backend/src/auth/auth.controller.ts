import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  private readonly defaultUserId = 'default-user-id';

  constructor(private readonly authService: AuthService) {}

  /**
   * Endpoint de login OAuth GitHub
   */
  @Post('github/login')
  loginWithGitHub(@Body() body: { code: string }) {
    return this.authService.loginWithGitHub(body.code);
  }

  /**
   * Récupère les dépôts GitHub de l'utilisateur connecté
   */
  @Get('github/repos')
  getGitHubRepositories(@Query('userId') queryUserId?: string) {
    const userId = queryUserId || this.defaultUserId;
    return this.authService.getGitHubRepositories(userId);
  }

  /**
   * Synchronise un dépôt GitHub à un projet Planner-Pro
   */
  @Post('github/sync')
  syncRepository(
    @Body() body: { projectId: string; repoFullName: string },
    @Query('userId') queryUserId?: string,
  ) {
    const userId = queryUserId || this.defaultUserId;
    return this.authService.syncRepositoryToProject(userId, body.projectId, body.repoFullName);
  }
}
