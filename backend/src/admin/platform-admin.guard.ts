import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PLATFORM_ROLES_KEY } from './platform-roles.decorator';

interface AuthenticatedRequest {
  user?: { id: string };
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Utilisateur authentifié introuvable.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { platformRole: true, mfaEnabled: true },
    });

    if (!user?.platformRole) {
      throw new ForbiddenException("L'accès à l'administration de la plateforme est refusé.");
    }

    // S18.3 : un compte de plateforme sans second facteur n'administre rien
    if (!user.mfaEnabled) {
      throw new ForbiddenException(
        "L'authentification à deux facteurs est obligatoire pour administrer la plateforme. Activez-la sur votre compte.",
      );
    }

    // S18.1 : rôles exigés par la route (poignée puis contrôleur)
    const required = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required && required.length > 0 && !required.includes(user.platformRole)) {
      throw new ForbiddenException(
        'Cette action est réservée à un rôle de plateforme supérieur (SUPER_ADMIN).',
      );
    }

    return true;
  }
}
