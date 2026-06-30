import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
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
    const token = this.extractTokenFromCookie(request);

    if (!token) {
      throw new UnauthorizedException("Token d'authentification manquant.");
    }

    try {
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET n'est pas défini.");
      }
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      // Assigner l'utilisateur décodé à la requête
      request['user'] = { id: payload.sub, email: payload.email, name: payload.name };
    } catch {
      throw new UnauthorizedException("Token d'authentification invalide ou expiré.");
    }

    return true;
  }

  private extractTokenFromCookie(request: Request): string | undefined {
    return request.cookies?.accessToken;
  }
}
