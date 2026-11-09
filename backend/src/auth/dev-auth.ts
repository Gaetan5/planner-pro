import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { isDevAuthEnabled } from './dev-auth-flag';
import { Public } from './public.decorator';
import { respondWithLogin, userAgentOf } from './login-response';

export class MockLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

@Controller('auth')
export class DevAuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('mock/login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async mockLogin(
    @Body() body: MockLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.mockLogin(body.name, { userAgent: userAgentOf(req) });
    return respondWithLogin(res, result);
  }
}

/** Contrôleurs à ajouter au module d'authentification : vide hors développement explicite. */
export const devAuthControllers = (env: NodeJS.ProcessEnv = process.env) =>
  isDevAuthEnabled(env) ? [DevAuthController] : [];
