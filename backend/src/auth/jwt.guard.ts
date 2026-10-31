import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_FORBIDDEN_IN_IMPERSONATION } from './forbidden-in-impersonation.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionService } from './session.service';
import { readAccessCookie } from './session-cookies';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private sessionService: SessionService,
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

    // Jeton d'accès (typ 'access', S3) ET session active, compte non suspendu (S7)
    const payload = await this.sessionService.verifyAccess(token);
    if (payload.impersonatedBy) {
      const forbidden = this.reflector.getAllAndOverride<boolean>(IS_FORBIDDEN_IN_IMPERSONATION, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (forbidden) {
        throw new ForbiddenException('Action interdite pendant une session d’impersonation.');
      }
    }
    // Assigner l'utilisateur décodé à la requête
    request['user'] = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      sid: payload.sid,
      impersonatedBy: payload.impersonatedBy,
    };

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const cookieToken = readAccessCookie(request);
    if (cookieToken) return cookieToken;

    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length).trim();
    }

    return undefined;
  }
}
