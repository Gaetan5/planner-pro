import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TokenService } from './token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private tokenService: TokenService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException("Token d'authentification manquant.");
    }

    // Seuls les jetons d'accès (typ 'access') sont acceptés : un ticket MFA est rejeté (S3)
    const payload = await this.tokenService.verifyAccessToken(token);
    // Assigner l'utilisateur décodé à la requête
    request['user'] = { id: payload.sub, email: payload.email, name: payload.name };

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const cookieToken = request.cookies?.accessToken;
    if (cookieToken) return cookieToken;

    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length).trim();
    }

    return undefined;
  }
}
