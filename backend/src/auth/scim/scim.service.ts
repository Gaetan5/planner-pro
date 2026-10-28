import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ScimUserResource,
  ScimListResponse,
  CreateScimUserDto,
  ScimPatchRequest,
} from './scim.dto';
import { WorkspaceRole } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class ScimService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mappe un utilisateur Prisma en ressource SCIM 2.0 User
   */
  private mapToScimUser(user: {
    id: string;
    email: string;
    name: string | null;
    isSuspended: boolean;
    createdAt: Date;
  }): ScimUserResource {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: user.id,
      userName: user.email,
      displayName: user.name || user.email.split('@')[0],
      name: {
        formatted: user.name || undefined,
        givenName: user.name?.split(' ')[0] || undefined,
        familyName: user.name?.split(' ').slice(1).join(' ') || undefined,
      },
      emails: [
        {
          value: user.email,
          type: 'work',
          primary: true,
        },
      ],
      active: !user.isSuspended,
      meta: {
        resourceType: 'User',
        created: user.createdAt.toISOString(),
        lastModified: user.createdAt.toISOString(),
        location: `/api/scim/v2/Users/${user.id}`,
      },
    };
  }

  /**
   * Liste paginée des utilisateurs du workspace pour SCIM 2.0
   */
  async listUsers(
    workspaceId: string,
    startIndex = 1,
    count = 100,
  ): Promise<ScimListResponse<ScimUserResource>> {
    const skip = Math.max(0, startIndex - 1);
    const take = Math.min(100, Math.max(1, count));

    const [memberships, total] = await Promise.all([
      this.prisma.membership.findMany({
        where: { workspaceId },
        include: { user: true },
        skip,
        take,
      }),
      this.prisma.membership.count({
        where: { workspaceId },
      }),
    ]);

    const resources = memberships.map((m) => this.mapToScimUser(m.user));

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /**
   * Récupère un utilisateur SCIM par son ID
   */
  async getUser(workspaceId: string, userId: string): Promise<ScimUserResource> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
      include: { user: true },
    });

    if (!membership) {
      throw new NotFoundException(`Utilisateur ${userId} introuvable dans cet espace.`);
    }

    return this.mapToScimUser(membership.user);
  }

  /**
   * Provisionne un nouvel utilisateur via SCIM 2.0
   */
  async createUser(workspaceId: string, dto: CreateScimUserDto): Promise<ScimUserResource> {
    const email = (dto.emails?.[0]?.value || dto.userName || '').toLowerCase().trim();

    if (!email) {
      throw new BadRequestException(
        "Une adresse e-mail est obligatoire pour provisionner l'utilisateur.",
      );
    }

    const name = dto.displayName || dto.name?.formatted || email.split('@')[0];
    const isSuspended = dto.active === false;

    let user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      // Si l'utilisateur existe déjà, vérifier s'il est déjà membre
      const existingMembership = await this.prisma.membership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: user.id } },
      });

      if (existingMembership) {
        throw new ConflictException(`L'utilisateur ${email} est déjà membre de cet espace.`);
      }

      await this.prisma.membership.create({
        data: {
          workspaceId,
          userId: user.id,
          role: WorkspaceRole.MEMBER,
        },
      });

      if (dto.active !== undefined) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { isSuspended },
        });
      }
    } else {
      user = await this.prisma.user.create({
        data: {
          email,
          name,
          isSuspended,
          memberships: {
            create: {
              workspaceId,
              role: WorkspaceRole.MEMBER,
            },
          },
        },
      });
    }

    return this.mapToScimUser(user);
  }

  /**
   * Met à jour complètement un utilisateur via SCIM (PUT)
   */
  async updateUser(
    workspaceId: string,
    userId: string,
    dto: CreateScimUserDto,
  ): Promise<ScimUserResource> {
    await this.getUser(workspaceId, userId);

    const email = (dto.emails?.[0]?.value || dto.userName || '').toLowerCase().trim();
    const name = dto.displayName || dto.name?.formatted;
    const isSuspended = dto.active === false;

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: email || undefined,
        name: name || undefined,
        isSuspended,
      },
    });

    return this.mapToScimUser(updatedUser);
  }

  /**
   * Applique un patch SCIM (PATCH) - Utilisé par Entra ID/Okta pour activer/suspendre
   */
  async patchUser(
    workspaceId: string,
    userId: string,
    patchRequest: ScimPatchRequest,
  ): Promise<ScimUserResource> {
    await this.getUser(workspaceId, userId);

    let isSuspendedUpdate: boolean | undefined = undefined;
    let nameUpdate: string | undefined = undefined;

    for (const op of patchRequest.Operations || []) {
      const path = (op.path || '').toLowerCase();
      if (path === 'active' || op.value?.active !== undefined) {
        const activeVal = path === 'active' ? op.value : op.value?.active;
        isSuspendedUpdate = !activeVal;
      }
      if (path === 'displayname' || op.value?.displayName) {
        nameUpdate = path === 'displayname' ? String(op.value) : String(op.value?.displayName);
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isSuspended: isSuspendedUpdate !== undefined ? isSuspendedUpdate : undefined,
        name: nameUpdate || undefined,
      },
    });

    return this.mapToScimUser(updated);
  }

  /**
   * Déprovisionne ou retire un utilisateur de l'espace de travail (DELETE)
   */
  async deleteUser(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });

    if (!membership) {
      throw new NotFoundException(`Utilisateur ${userId} introuvable dans cet espace.`);
    }

    // Retirer le membre du workspace
    await this.prisma.membership.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
  }

  /**
   * Métadonnées de compatibilité SCIM 2.0 (RFC 7644)
   */
  getServiceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          name: 'OAuth Bearer Token',
          description: 'Authentification par jeton Bearer SCIM d’espace de travail',
          specUri: 'http://tools.ietf.org/html/rfc6750',
          type: 'oauthbearertoken',
          primary: true,
        },
      ],
    };
  }

  // --- Gestion des Clés API SCIM pour les Administrateurs de Workspace ---

  async createApiKey(workspaceId: string, userId: string, name: string) {
    await this.verifyWorkspaceAdmin(workspaceId, userId);

    const rawToken = `scim_live_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const record = await this.prisma.sCIMApiKey.create({
      data: {
        workspaceId,
        name: name.trim() || 'Clé SCIM Entra/Okta',
        tokenHash,
      },
    });

    return {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      // La clé brute n'est retournée qu'une seule fois à la création
      apiKey: rawToken,
    };
  }

  async listApiKeys(workspaceId: string, userId: string) {
    await this.verifyWorkspaceAdmin(workspaceId, userId);

    return this.prisma.sCIMApiKey.findMany({
      where: { workspaceId, revokedAt: null },
      select: {
        id: true,
        name: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeApiKey(workspaceId: string, userId: string, keyId: string) {
    await this.verifyWorkspaceAdmin(workspaceId, userId);

    return this.prisma.sCIMApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  private async verifyWorkspaceAdmin(workspaceId: string, userId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });

    if (
      !membership ||
      (membership.role !== WorkspaceRole.OWNER && membership.role !== WorkspaceRole.ADMIN)
    ) {
      throw new ForbiddenException("Droits administrateur de l'espace de travail requis.");
    }
  }
}
