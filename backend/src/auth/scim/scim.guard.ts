import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class ScimAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentification Bearer SCIM requise.');
    }

    const token = authHeader.substring(7).trim();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const apiKey = await this.prisma.sCIMApiKey.findUnique({
      where: { tokenHash },
      include: { workspace: true },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Clé API SCIM invalide.');
    }

    if (apiKey.revokedAt) {
      throw new UnauthorizedException('Cette clé API SCIM a été révoquée.');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('Cette clé API SCIM a expiré.');
    }

    // Mise à jour de lastUsedAt en arrière-plan
    this.prisma.sCIMApiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    // Injection du workspace dans la requête
    request['scimWorkspace'] = apiKey.workspace;
    request['scimApiKeyId'] = apiKey.id;

    return true;
  }
}
