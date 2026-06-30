import { Controller, Post, Get, Body, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setTokenCookie(res: Response, token: string) {
    res.cookie('accessToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000, // 1 heure
    });
  }

  /**
   * Endpoint de login OAuth GitHub
   */
  @Post('github/login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async loginWithGitHub(@Body() body: { code: string }, @Res({ passthrough: true }) res: Response) {
    const { user, accessToken } = await this.authService.loginWithGitHub(body.code);
    this.setTokenCookie(res, accessToken);
    return { user };
  }

  /**
   * Endpoint d'inscription classique
   */
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(@Body() registerDto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { user, accessToken } = await this.authService.register(
      registerDto.email,
      registerDto.passwordRaw,
      registerDto.name,
    );
    this.setTokenCookie(res, accessToken);
    return { user };
  }

  /**
   * Endpoint de login classique
   */
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, accessToken } = await this.authService.login(
      loginDto.email,
      loginDto.passwordRaw,
    );
    this.setTokenCookie(res, accessToken);
    return { user };
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
  syncRepository(@Body() body: { projectId: string; repoFullName: string }, @Req() req: any) {
    const userId = req.user.id;
    return this.authService.syncRepositoryToProject(userId, body.projectId, body.repoFullName);
  }
}
