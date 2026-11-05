import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ScimAuthGuard implements CanActivate {
  private readonly logger = new Logger('ScimAudit');

  constructor(private readonly prisma: PrismaService) {}

  private fail(
    request: {
      method?: string;
      url?: string;
      route?: { path?: string };
    },
    reason: string,
  ): never {
    this.logger.warn(
      JSON.stringify({
        event: 'SCIM_OPERATION',
        method: request.method,
        route: request.route?.path || request.url,
        outcome: 'failure',
        status: 401,
        reason,
      }),
    );
    throw new UnauthorizedException(reason);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.fail(request, 'Authentification Bearer SCIM requise.');
    }

    const token = authHeader.substring(7).trim();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const apiKey = await this.prisma.sCIMApiKey.findUnique({
      where: { tokenHash },
      include: { workspace: true },
    });

    if (!apiKey) {
      this.fail(request, 'Clé API SCIM invalide.');
    }

    if (apiKey.revokedAt) {
      this.fail(request, 'Cette clé API SCIM a été révoquée.');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      this.fail(request, 'Cette clé API SCIM a expiré.');
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
