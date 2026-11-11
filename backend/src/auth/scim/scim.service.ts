import { RealtimeService } from '../../realtime/realtime.service';
import {
  Injectable,
  Logger,
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
  CreateScimKeyDto,
  ScimPatchRequestDto,
} from './scim.dto';
import { InvitationStatus, WorkspaceRole } from '@prisma/client';
import { FirestoreSyncService } from '../../firestore-sync/firestore-sync.service';
import { invitationSyncPayload } from '../../projects/invitation-sync-payload';
import * as crypto from 'crypto';
import { SCIM_TEXT_MAX } from './scim.dto';

@Injectable()
export class ScimService {
  private readonly logger = new Logger('ScimAudit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly firestoreSync: FirestoreSyncService,
  ) {}

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

  /**
   * N3 : valeur textuelle d'un attribut SCIM destinée à une colonne VARCHAR(191) (`User.name`,
   * `User.email`). Refus 400 `invalidValue` (RFC 7644 §3.12) au lieu d'une erreur de base (500).
   * r53-m1 : `undefined` est refusé aussi (jamais converti en la chaîne « undefined »).
   */
  private scimText(attribute: string, raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new BadRequestException(
        this.scimError(
          400,
          `L'attribut ${attribute} doit être une chaîne de caractères.`,
          'invalidValue',
        ),
      );
    }
    const text = raw;
    if (text.length > SCIM_TEXT_MAX) {
      throw new BadRequestException(
        this.scimError(
          400,
          `L'attribut ${attribute} ne peut pas dépasser ${SCIM_TEXT_MAX} caractères.`,
          'invalidValue',
        ),
      );
    }
    return text;
  }

  /**
   * r54-m1 : valeur booléenne SCIM. Entra ID envoie `"False"` / `"True"` en chaîne (sans le
   * drapeau aadOptscim062020), Okta et RFC 7644 un booléen JSON. Tout le reste : 400 `invalidValue`.
   */
  private scimBoolean(raw: unknown): boolean {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      const text = raw.toLowerCase();
      if (text === 'true') return true;
      if (text === 'false') return false;
    }
    throw new BadRequestException(
      this.scimError(
        400,
        "L'attribut active doit être un booléen (true ou false).",
        'invalidValue',
      ),
    );
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
   * Révoque les invitations en attente adressées à l'utilisateur dans ce workspace (S17-a) : un
   * compte déprovisionné ne doit pas retrouver une appartenance avec un lien reçu avant son départ.
   */
  private async revokePendingInvitations(workspaceId: string, email: string): Promise<void> {
    const pending = await this.prisma.invitation.findMany({
      where: {
        workspaceId,
        status: InvitationStatus.PENDING,
        email: email.trim().toLowerCase(),
      },
    });
    if (pending.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      for (const invitation of pending) {
        const result = await tx.invitation.updateMany({
          where: { id: invitation.id, status: InvitationStatus.PENDING },
          data: { status: InvitationStatus.REVOKED },
        });
        if (result.count !== 1) continue;
        await this.firestoreSync.enqueue(tx, {
          entityType: 'invitation',
          entityId: invitation.id,
          workspaceId,
          operation: 'upsert',
          payload: invitationSyncPayload({ ...invitation, status: InvitationStatus.REVOKED }),
        });
      }
    });
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
      // Le flux temps réel du workspace est coupé immédiatement (S16)
      await this.realtime.refreshUserRooms(userId);
      return false;
    }

    if (active && !membership) {
      await this.prisma.membership.create({
        data: { workspaceId, userId, role: WorkspaceRole.MEMBER },
      });
      await this.realtime.refreshUserRooms(userId);
      return true;
    }

    return membership !== null;
  }

  /**
   * Liste paginée des utilisateurs du workspace pour SCIM 2.0. Seul le filtre
   * `userName eq "<adresse>"` est pris en charge (RFC 7644 §3.4.2.2) ; tout autre filtre : 400.
   */
  async listUsers(
    workspaceId: string,
    startIndex = 1,
    count = 100,
    filter?: string,
  ): Promise<ScimListResponse<ScimUserResource>> {
    const start = Math.max(1, startIndex);
    const skip = start - 1;
    const take = Math.min(100, Math.max(0, count));

    let where: { workspaceId: string; userId?: string } = { workspaceId };
    if (filter) {
      const match = /^userName\s+eq\s+"([^"]{1,254})"$/i.exec(filter.trim());
      if (!match) {
        throw new BadRequestException(
          this.scimError(
            400,
            'Seul le filtre userName eq "…" est pris en charge.',
            'invalidFilter',
          ),
        );
      }
      const target = await this.prisma.user.findUnique({
        where: { email: match[1].toLowerCase().trim() },
        select: { id: true },
      });
      // Aucun utilisateur de ce nom : liste vide (jamais d'information sur un compte hors workspace)
      where = { workspaceId, userId: target?.id ?? '' };
    }

    const [memberships, total] = await Promise.all([
      take === 0
        ? Promise.resolve([])
        : this.prisma.membership.findMany({
            where,
            include: { user: true },
            skip,
            take,
          }),
      this.prisma.membership.count({ where }),
    ]);

    const resources = memberships.map((m) => this.mapToScimUser(m.user, true));

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex: start,
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
   * L'adresse doit appartenir au domaine VÉRIFIÉ (DNS) du workspace (S10/S11) : un administrateur
   * ne peut pas provisionner des comptes sur le domaine d'une autre organisation. Un e-mail déjà
   * connu de la plateforme n'est jamais rattaché silencieusement (409).
   */
  async createUser(workspaceId: string, dto: CreateScimUserDto): Promise<ScimUserResource> {
    const email = (dto.emails?.[0]?.value || dto.userName || '').toLowerCase().trim();

    if (!email) {
      throw new BadRequestException(
        "Une adresse e-mail est obligatoire pour provisionner l'utilisateur.",
      );
    }

    const config = await this.prisma.sSOConfiguration.findUnique({ where: { workspaceId } });
    const domain = email.split('@')[1];
    // Source de vérité unique : verifiedDomain, posé seulement par la preuve DNS (S10-h)
    if (!config?.verifiedDomain || !domain || domain !== config.verifiedDomain) {
      throw new ForbiddenException(
        this.scimError(
          403,
          "L'adresse doit appartenir au domaine vérifié de l'organisation.",
          'invalidValue',
        ),
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

  /** Adresses portées par une valeur de PATCH : chaîne, `{ value }` ou tableau de ces formes. */
  private emailValues(input: unknown): string[] {
    if (typeof input === 'string') return [input];
    if (Array.isArray(input)) return input.flatMap((item) => this.emailValues(item));
    if (input && typeof input === 'object') {
      const value = (input as { value?: unknown }).value;
      return typeof value === 'string' ? [value] : [];
    }
    return [];
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
    patchRequest: ScimPatchRequestDto,
  ): Promise<ScimUserResource> {
    const { user, membership, provisionedHere } = await this.resolveScimUser(workspaceId, userId);

    let activeUpdate: boolean | undefined = undefined;
    let nameUpdate: string | undefined = undefined;

    for (const op of patchRequest.Operations || []) {
      const path = (op.path || '').toLowerCase();
      if (path === 'active' || op.value?.active !== undefined) {
        // r54-m1 : `active` n'est jamais déduit d'une absence ou d'une valeur invalide
        if (op.op === 'remove') {
          throw new BadRequestException(
            this.scimError(
              400,
              "L'attribut active ne peut pas être supprimé : utiliser replace avec true ou false.",
              'mutability',
            ),
          );
        }
        activeUpdate = this.scimBoolean(path === 'active' ? op.value : op.value?.active);
      }
      if (path === 'displayname' || op.value?.displayName !== undefined) {
        // r53-m1 : `User.name` est obligatoire ; retirer (ou vider) displayName est refusé
        if (op.op === 'remove' || (path === 'displayname' && op.value === undefined)) {
          throw new BadRequestException(
            this.scimError(
              400,
              "L'attribut displayName est obligatoire et ne peut pas être supprimé.",
              'mutability',
            ),
          );
        }
        nameUpdate = this.scimText(
          'displayName',
          path === 'displayname' ? op.value : op.value?.displayName,
        );
        // r54-a1 : un nom vide ou blanc n'est pas une valeur (jamais un 200 sans effet)
        if (nameUpdate.trim() === '') {
          throw new BadRequestException(
            this.scimError(400, "L'attribut displayName ne peut pas être vide.", 'invalidValue'),
          );
        }
      }
      if (path === 'username' || op.value?.userName) {
        const requested = path === 'username' ? op.value : op.value?.userName;
        this.assertEmailUnchanged(
          user.email,
          typeof requested === 'string' ? this.scimText('userName', requested) : String(requested),
        );
      }
      // emails[...] : chaîne, objet ou tableau ; toute adresse différente est refusée (S11)
      if (path.startsWith('emails') || op.value?.emails !== undefined) {
        const candidates = path.startsWith('emails') ? op.value : op.value?.emails;
        for (const requested of this.emailValues(candidates)) {
          this.assertEmailUnchanged(user.email, this.scimText('emails', requested));
        }
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

    if (activeUpdate === false) {
      await this.revokePendingInvitations(workspaceId, user.email);
    }

    return this.mapToScimUser(current, active);
  }

  /**
   * Déprovisionne l'utilisateur de l'espace de travail (DELETE) : retire la membership, supprime
   * ses rôles de projet dans ce workspace (S17 : une reprovision ultérieure ne doit pas les
   * rendre en silence, contrairement à une simple suspension `active=false`) et, pour un compte
   * créé par ce workspace, abandonne le rattachement de provisionnement.
   */
  async deleteUser(workspaceId: string, userId: string): Promise<void> {
    const { user, membership, provisionedHere } = await this.resolveScimUser(workspaceId, userId);

    if (membership) {
      await this.applyActiveState(workspaceId, userId, membership, false);
    }

    await this.prisma.projectMembership.deleteMany({
      where: { userId, project: { workspaceId } },
    });
    await this.realtime.refreshUserRooms(userId);
    await this.revokePendingInvitations(workspaceId, user.email);

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

  async createApiKey(workspaceId: string, userId: string, dto: CreateScimKeyDto) {
    await this.verifyWorkspaceAdmin(workspaceId, userId);

    const rawToken = `scim_live_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    // Expiration par défaut de 365 jours : une clé SCIM ne doit pas être éternelle (S11)
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? 365) * 24 * 3600 * 1000);

    const record = await this.prisma.sCIMApiKey.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        tokenHash,
        expiresAt,
      },
    });
    this.logger.log(
      JSON.stringify({ event: 'SCIM_KEY_CREATED', workspaceId, keyId: record.id, actorId: userId }),
    );

    return {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
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
    this.logger.log(
      JSON.stringify({ event: 'SCIM_KEY_REVOKED', workspaceId, keyId, actorId: userId }),
    );
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
