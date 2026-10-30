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
   * Mappe un utilisateur Prisma en ressource SCIM 2.0 User.
   * `active` reflète l'appartenance au workspace de la clé SCIM, jamais l'état global du compte (S1).
   */
  private mapToScimUser(
    user: {
      id: string;
      email: string;
      name: string | null;
      createdAt: Date;
    },
    active: boolean,
  ): ScimUserResource {
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
      active,
      meta: {
        resourceType: 'User',
        created: user.createdAt.toISOString(),
        lastModified: user.createdAt.toISOString(),
        location: `/api/scim/v2/Users/${user.id}`,
      },
    };
  }

  private scimError(status: number, detail: string, scimType?: string) {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: String(status),
      ...(scimType ? { scimType } : {}),
      detail,
    };
  }

  /**
   * Résout un utilisateur visible par le workspace de la clé SCIM : membre du workspace,
   * ou compte créé par ce workspace (pour permettre la réactivation). Sinon 404 (S1).
   */
  private async resolveScimUser(workspaceId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { where: { workspaceId } } },
    });

    const membership = user?.memberships.find((m) => m.workspaceId === workspaceId) ?? null;
    const provisionedHere = user?.provisionedByWorkspaceId === workspaceId;

    if (!user || (!membership && !provisionedHere)) {
      throw new NotFoundException(`Utilisateur ${userId} introuvable dans cet espace.`);
    }

    return { user, membership, provisionedHere };
  }

  /**
   * Applique l'état `active` SCIM à l'appartenance au workspace uniquement :
   * false retire la membership, true la recrée (comptes provisionnés par ce workspace).
   * `User.isSuspended` n'est jamais modifié par SCIM (S1).
   */
  private async applyActiveState(
    workspaceId: string,
    userId: string,
    membership: { role: WorkspaceRole } | null,
    active: boolean,
  ): Promise<boolean> {
    if (!active && membership) {
      if (membership.role === WorkspaceRole.OWNER) {
        throw new BadRequestException(
          this.scimError(
            400,
            "Le propriétaire de l'espace de travail ne peut pas être désactivé par SCIM.",
            'mutability',
          ),
        );
      }
      await this.prisma.membership.delete({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      return false;
    }

    if (active && !membership) {
      await this.prisma.membership.create({
        data: { workspaceId, userId, role: WorkspaceRole.MEMBER },
      });
      return true;
    }

    return membership !== null;
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

    const resources = memberships.map((m) => this.mapToScimUser(m.user, true));

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
    const { user, membership } = await this.resolveScimUser(workspaceId, userId);
    return this.mapToScimUser(user, membership !== null);
  }

  /**
   * Provisionne un nouvel utilisateur via SCIM 2.0.
   * Un e-mail déjà connu de la plateforme n'est jamais rattaché silencieusement (409) : la preuve
   * de propriété du domaine arrive en Phase 2 (S10).
   */
  async createUser(workspaceId: string, dto: CreateScimUserDto): Promise<ScimUserResource> {
    const email = (dto.emails?.[0]?.value || dto.userName || '').toLowerCase().trim();

    if (!email) {
      throw new BadRequestException(
        "Une adresse e-mail est obligatoire pour provisionner l'utilisateur.",
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(
        this.scimError(409, `L'utilisateur ${email} existe déjà.`, 'uniqueness'),
      );
    }

    const name = dto.displayName || dto.name?.formatted || email.split('@')[0];
    const active = dto.active !== false;

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        provisionedByWorkspaceId: workspaceId,
        ...(active ? { memberships: { create: { workspaceId, role: WorkspaceRole.MEMBER } } } : {}),
      },
    });

    return this.mapToScimUser(user, active);
  }

  /**
   * Vérifie qu'une requête SCIM ne tente pas de changer l'e-mail (identifiant global) du compte.
   */
  private assertEmailUnchanged(currentEmail: string, requested?: string) {
    const normalized = (requested || '').toLowerCase().trim();
    if (normalized && normalized !== currentEmail.toLowerCase()) {
      throw new BadRequestException(
        this.scimError(
          400,
          "L'adresse e-mail d'un compte ne peut pas être modifiée par SCIM.",
          'mutability',
        ),
      );
    }
  }

  /**
   * Met à jour un utilisateur via SCIM (PUT).
   * Seuls le nom (comptes provisionnés par ce workspace) et l'état actif dans le workspace changent.
   */
  async updateUser(
    workspaceId: string,
    userId: string,
    dto: CreateScimUserDto,
  ): Promise<ScimUserResource> {
    const { user, membership, provisionedHere } = await this.resolveScimUser(workspaceId, userId);

    this.assertEmailUnchanged(user.email, dto.emails?.[0]?.value || dto.userName);

    let current = user;
    const name = dto.displayName || dto.name?.formatted;
    if (name && provisionedHere && name !== user.name) {
      current = {
        ...user,
        ...(await this.prisma.user.update({ where: { id: userId }, data: { name } })),
      };
    }

    const active = await this.applyActiveState(
      workspaceId,
      userId,
      membership,
      dto.active !== false,
    );

    return this.mapToScimUser(current, active);
  }

  /**
   * Applique un patch SCIM (PATCH) - Utilisé par Entra ID/Okta pour activer/désactiver
   */
  async patchUser(
    workspaceId: string,
    userId: string,
    patchRequest: ScimPatchRequest,
  ): Promise<ScimUserResource> {
    const { user, membership, provisionedHere } = await this.resolveScimUser(workspaceId, userId);

    let activeUpdate: boolean | undefined = undefined;
    let nameUpdate: string | undefined = undefined;

    for (const op of patchRequest.Operations || []) {
      const path = (op.path || '').toLowerCase();
      if (path === 'active' || op.value?.active !== undefined) {
        const activeVal = path === 'active' ? op.value : op.value?.active;
        activeUpdate = activeVal === true || activeVal === 'true' || activeVal === 'True';
      }
      if (path === 'displayname' || op.value?.displayName) {
        nameUpdate = path === 'displayname' ? String(op.value) : String(op.value?.displayName);
      }
      if (path === 'username' || path.startsWith('emails') || op.value?.userName) {
        this.assertEmailUnchanged(
          user.email,
          path === 'username' ? String(op.value) : op.value?.userName,
        );
      }
    }

    let current = user;
    if (nameUpdate && provisionedHere && nameUpdate !== user.name) {
      current = {
        ...user,
        ...(await this.prisma.user.update({ where: { id: userId }, data: { name: nameUpdate } })),
      };
    }

    const active =
      activeUpdate === undefined
        ? membership !== null
        : await this.applyActiveState(workspaceId, userId, membership, activeUpdate);

    return this.mapToScimUser(current, active);
  }

  /**
   * Déprovisionne l'utilisateur de l'espace de travail (DELETE) : retire la membership et,
   * pour un compte créé par ce workspace, abandonne le rattachement de provisionnement.
   */
  async deleteUser(workspaceId: string, userId: string): Promise<void> {
    const { membership, provisionedHere } = await this.resolveScimUser(workspaceId, userId);

    if (membership) {
      await this.applyActiveState(workspaceId, userId, membership, false);
    }

    if (provisionedHere) {
      await this.prisma.user.updateMany({
        where: { id: userId, provisionedByWorkspaceId: workspaceId },
        data: { provisionedByWorkspaceId: null },
      });
    }
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

    // Révocation limitée aux clés du workspace de l'appelant (S1)
    const revokedAt = new Date();
    const result = await this.prisma.sCIMApiKey.updateMany({
      where: { id: keyId, workspaceId, revokedAt: null },
      data: { revokedAt },
    });
    if (result.count === 0) {
      throw new NotFoundException('Clé API SCIM introuvable dans cet espace.');
    }
    return { id: keyId, revokedAt };
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
