import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { InvitationsService } from '../../../src/projects/invitations.service';
import { PolicyService } from '../../../src/authz/policy.service';
import { CreateInvitationDto } from '../../../src/projects/dto/create-invitation.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/**
 * S17 : tests d'abus des invitations, sur un faux Prisma en mémoire qui évalue réellement les
 * `where` (statut, expiration) pour que la concurrence et les filtres soient démontrés.
 */
type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

interface InvRow {
  id: string;
  email: string | null;
  tokenHash: string;
  role: Role;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  workspaceId: string;
  projectId: string | null;
  projectRole: string | null;
  invitedById: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

function buildFake() {
  const invitations: InvRow[] = [];
  const memberships: Array<{
    id: string;
    workspaceId: string;
    userId: string;
    role: Role;
    createdAt: Date;
  }> = [];
  const projectMemberships: Array<{ projectId: string; userId: string; role: string }> = [];
  const projects = [{ id: 'p1', workspaceId: 'ws1', deletedAt: null as Date | null }];
  let seq = 0;
  const self: { current?: unknown } = {};

  const prisma = {
    invitations,
    memberships,
    projectMemberships,
    membership: {
      findFirst: jest.fn(
        async ({ where }: { where: { workspaceId: string; userId: string; role?: unknown } }) => {
          const roles = (where.role as { in?: Role[] } | undefined)?.in;
          return (
            memberships.find(
              (m) =>
                m.workspaceId === where.workspaceId &&
                m.userId === where.userId &&
                (!roles || roles.includes(m.role)),
            ) ?? null
          );
        },
      ),
      create: jest.fn(
        async ({ data }: { data: { workspaceId: string; userId: string; role: Role } }) => {
          const row = { id: `m${++seq}`, createdAt: new Date(), ...data };
          memberships.push(row);
          return row;
        },
      ),
    },
    project: {
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; workspaceId?: string; deletedAt: null } }) =>
          projects.find(
            (p) =>
              p.id === where.id &&
              (!where.workspaceId || p.workspaceId === where.workspaceId) &&
              p.deletedAt === null,
          ) ?? null,
      ),
    },
    projectMembership: {
      findUnique: jest.fn(
        async ({ where }: { where: { projectId_userId: { projectId: string; userId: string } } }) =>
          projectMemberships.find(
            (pm) =>
              pm.projectId === where.projectId_userId.projectId &&
              pm.userId === where.projectId_userId.userId,
          ) ?? null,
      ),
      create: jest.fn(
        async ({ data }: { data: { projectId: string; userId: string; role: string } }) => {
          projectMemberships.push(data);
          return data;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { projectId_userId: { projectId: string; userId: string } };
          data: { role: string };
        }) => {
          const row = projectMemberships.find(
            (pm) =>
              pm.projectId === where.projectId_userId.projectId &&
              pm.userId === where.projectId_userId.userId,
          )!;
          row.role = data.role;
          return row;
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { projectId_userId: { projectId: string; userId: string } };
          create: { projectId: string; userId: string; role: string };
          update: { role: string };
        }) => {
          const row = projectMemberships.find(
            (pm) =>
              pm.projectId === where.projectId_userId.projectId &&
              pm.userId === where.projectId_userId.userId,
          );
          if (row) row.role = update.role;
          else projectMemberships.push(create);
          return row ?? create;
        },
      ),
    },
    invitation: {
      create: jest.fn(async ({ data }: { data: Partial<InvRow> }) => {
        const row = {
          id: `i${++seq}`,
          status: 'PENDING',
          acceptedAt: null,
          createdAt: new Date(),
          projectId: null,
          projectRole: null,
          ...data,
        } as InvRow;
        invitations.push(row);
        return row;
      }),
      // Copie : le service lit un instantané, pas la ligne vivante
      findUnique: jest.fn(async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
        const row = invitations.find((i) => i.tokenHash === where.tokenHash || i.id === where.id);
        return row ? { ...row } : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = invitations.find((i) => i.id === where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<InvRow> }) => {
        const row = invitations.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string; expiresAt?: { gt: Date } };
          data: Partial<InvRow>;
        }) => {
          const rows = invitations.filter(
            (i) =>
              i.id === where.id &&
              (!where.status || i.status === where.status) &&
              (!where.expiresAt || i.expiresAt > where.expiresAt.gt),
          );
          rows.forEach((r) => Object.assign(r, data));
          return { count: rows.length };
        },
      ),
    },
    workspace: { findUnique: jest.fn(async () => ({ name: 'WS' })) },
    user: { findUnique: jest.fn(async () => ({ name: 'Admin', email: 'admin@corp.com' })) },
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(self.current)),
  };
  self.current = prisma;
  return prisma;
}

describe('S17 : invitations', () => {
  let prisma: ReturnType<typeof buildFake>;
  let service: InvitationsService;
  const mail = { sendInvitationEmail: jest.fn().mockResolvedValue(true) };
  const realtime = { refreshUserRooms: jest.fn() };
  const sync = { enqueue: jest.fn().mockResolvedValue(undefined) };

  const member = (userId: string, role: Role, workspaceId = 'ws1') =>
    prisma.memberships.push({
      id: `seed-${userId}`,
      workspaceId,
      userId,
      role,
      createdAt: new Date(),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildFake();
    member('owner', 'OWNER');
    member('admin', 'ADMIN');
    member('member', 'MEMBER');
    const policy = new PolicyService(prisma as never);
    service = new InvitationsService(
      prisma as never,
      mail as never,
      sync as never,
      policy,
      realtime as never,
    );
  });

  const token = async (
    inviter: string,
    email: string | null,
    role: Role,
    projectId?: string,
    days = 7,
    projectRole?: string,
  ) => {
    const res = await (
      service.createInvitation as unknown as (...a: unknown[]) => Promise<{ rawToken: string }>
    )('ws1', inviter, email, role, projectId, days, projectRole);
    return res.rawToken;
  };

  describe('liaison à l’adresse e-mail', () => {
    it('invitation pour a@x.com acceptée par b@y.com : 403, aucune membership créée', async () => {
      const t = await token('admin', 'a@x.com', 'MEMBER');
      await expect(
        service.validateAndAcceptInvitation(t, { id: 'attacker', email: 'b@y.com' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.memberships.find((m) => m.userId === 'attacker')).toBeUndefined();
      expect(prisma.invitations[0].status).toBe('PENDING');
    });

    it('la comparaison ignore la casse', async () => {
      const t = await token('admin', 'A@X.com', 'MEMBER');
      await expect(
        service.validateAndAcceptInvitation(t, { id: 'u1', email: 'a@x.COM' }),
      ).resolves.toBeDefined();
      expect(prisma.memberships.find((m) => m.userId === 'u1')?.role).toBe('MEMBER');
    });
  });

  describe('rôles invitables', () => {
    it('un ADMIN qui invite en OWNER : 403', async () => {
      await expect(token('admin', 'a@x.com', 'OWNER')).rejects.toThrow(ForbiddenException);
      expect(prisma.invitations).toHaveLength(0);
    });

    it('même un OWNER ne peut pas inviter en OWNER', async () => {
      await expect(token('owner', 'a@x.com', 'OWNER')).rejects.toThrow(ForbiddenException);
    });

    it('un OWNER peut inviter en ADMIN, un ADMIN aussi (rôle <= invitant)', async () => {
      await expect(token('owner', 'a@x.com', 'ADMIN')).resolves.toBeDefined();
      await expect(token('admin', 'b@x.com', 'ADMIN')).resolves.toBeDefined();
    });

    it('une invitation OWNER antérieure (ligne en base) n’est jamais acceptable', async () => {
      const t = await token('owner', 'a@x.com', 'ADMIN');
      prisma.invitations[0].role = 'OWNER';
      await expect(
        service.validateAndAcceptInvitation(t, { id: 'u1', email: 'a@x.com' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.memberships.find((m) => m.userId === 'u1')).toBeUndefined();
    });

    it('l’invitant déprovisionné depuis (plus ADMIN) : l’invitation n’est plus acceptable', async () => {
      const t = await token('admin', 'a@x.com', 'ADMIN');
      prisma.memberships.splice(
        prisma.memberships.findIndex((m) => m.userId === 'admin'),
        1,
      );
      await expect(
        service.validateAndAcceptInvitation(t, { id: 'u1', email: 'a@x.com' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.memberships.find((m) => m.userId === 'u1')).toBeUndefined();
    });
  });

  describe('invitation à un projet', () => {
    it('crée une membership workspace VIEWER (jamais ADMIN) et le rôle de projet choisi', async () => {
      const t = await token('owner', 'ext@x.com', 'ADMIN', 'p1', 7, 'COMMENTER');
      await service.validateAndAcceptInvitation(t, { id: 'ext', email: 'ext@x.com' });
      expect(prisma.memberships.find((m) => m.userId === 'ext')?.role).toBe('VIEWER');
      expect(prisma.projectMemberships).toEqual([
        { projectId: 'p1', userId: 'ext', role: 'COMMENTER' },
      ]);
    });

    it('invitation de projet héritée (rôle ADMIN, projectRole nul) : VIEWER du workspace et CLIENT du projet', async () => {
      const t = await token('owner', 'ext@x.com', 'ADMIN');
      // Ligne antérieure à la migration : rôle de workspace ADMIN sur un projet, sans projectRole
      Object.assign(prisma.invitations[0], { role: 'ADMIN', projectId: 'p1', projectRole: null });
      await service.validateAndAcceptInvitation(t, { id: 'ext', email: 'ext@x.com' });
      expect(prisma.memberships.find((m) => m.userId === 'ext')?.role).toBe('VIEWER');
      expect(prisma.projectMemberships).toEqual([
        { projectId: 'p1', userId: 'ext', role: 'CLIENT' },
      ]);
    });

    it('sans projectRole : CLIENT (le plus restreint)', async () => {
      const t = await token('owner', 'ext@x.com', 'MEMBER', 'p1');
      await service.validateAndAcceptInvitation(t, { id: 'ext', email: 'ext@x.com' });
      expect(prisma.projectMemberships[0].role).toBe('CLIENT');
    });

    it('un membre existant n’est jamais rétrogradé sur le projet', async () => {
      member('boss', 'MEMBER');
      prisma.projectMemberships.push({ projectId: 'p1', userId: 'boss', role: 'MANAGER' });
      const t = await token('owner', 'boss@x.com', 'VIEWER', 'p1', 7, 'CLIENT');
      await service.validateAndAcceptInvitation(t, { id: 'boss', email: 'boss@x.com' });
      expect(prisma.projectMemberships[0].role).toBe('MANAGER');
    });
  });

  describe('liens anonymes', () => {
    it('refusé sans projet', async () => {
      await expect(token('admin', null, 'MEMBER')).rejects.toThrow(BadRequestException);
    });

    it('refusé pour un rôle de projet MANAGER', async () => {
      await expect(token('admin', null, 'VIEWER', 'p1', 7, 'MANAGER')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('autorisé pour un projet, et à usage unique : la seconde personne échoue', async () => {
      const t = await token('admin', null, 'VIEWER', 'p1', 7, 'CONTRIBUTOR');
      await service.validateAndAcceptInvitation(t, { id: 'u1', email: 'u1@x.com' });
      await expect(
        service.validateAndAcceptInvitation(t, { id: 'u2', email: 'u2@x.com' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.memberships.find((m) => m.userId === 'u2')).toBeUndefined();
    });
  });

  describe('durée', () => {
    it('durationDays > 30 : 400', async () => {
      await expect(token('admin', 'a@x.com', 'MEMBER', undefined, 3650)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('acceptation atomique', () => {
    it('deux acceptations concurrentes du même lien : une seule réussit, une seule membership', async () => {
      const t = await token('admin', null, 'VIEWER', 'p1', 7, 'CLIENT');
      const outcomes = await Promise.allSettled([
        service.validateAndAcceptInvitation(t, { id: 'u1', email: 'u1@x.com' }),
        service.validateAndAcceptInvitation(t, { id: 'u2', email: 'u2@x.com' }),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(prisma.memberships.filter((m) => m.userId === 'u1' || m.userId === 'u2')).toHaveLength(
        1,
      );
    });

    it('invitation expirée entre la lecture et l’écriture : refusée', async () => {
      const t = await token('admin', 'a@x.com', 'MEMBER');
      const original = prisma.invitation.findUnique.getMockImplementation()!;
      prisma.invitation.findUnique.mockImplementationOnce(
        async (args: { where: { tokenHash?: string; id?: string } }) => {
          const row = await original(args);
          // La ligne est lue valide, puis expire avant la mise à jour conditionnelle
          prisma.invitations[0].expiresAt = new Date(Date.now() - 1000);
          return row;
        },
      );
      await expect(
        service.validateAndAcceptInvitation(t, { id: 'u1', email: 'a@x.com' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.memberships.find((m) => m.userId === 'u1')).toBeUndefined();
    });
  });

  describe('DTO', () => {
    const errorsFor = async (body: object) =>
      (await validate(plainToInstance(CreateInvitationDto, body))).map((e) => e.property);

    it('durationDays > 30 rejeté, 30 accepté', async () => {
      expect(await errorsFor({ role: 'MEMBER', durationDays: 31 })).toContain('durationDays');
      expect(await errorsFor({ role: 'MEMBER', durationDays: 30 })).toEqual([]);
    });

    it('projectRole hors énumération rejeté', async () => {
      expect(
        await errorsFor({ projectId: '3f1c2d6e-8a41-4b7e-9c55-0d2a1b7e4f10', projectRole: 'GOD' }),
      ).toContain('projectRole');
    });
  });
});
