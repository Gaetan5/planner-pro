import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PlatformRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TokenService } from '../auth/token.service';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly firestoreSync: FirestoreSyncService,
    private readonly tokenService: TokenService,
  ) {}

  async getOverview() {
    const [users, workspaces, projects, tasks, notifications] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.workspace.count(),
      this.prisma.project.count(),
      this.prisma.task.count(),
      this.prisma.notification.count(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      totals: { users, workspaces, projects, tasks, notifications },
    };
  }

  async getHealth() {
    const [database, redis, firestoreSync] = await Promise.all([
      this.checkDependency('database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.checkDependency('redis', async () => {
        await this.redis.ping();
      }),
      this.firestoreSync.getStatus(),
    ]);

    return {
      status:
        database === 'healthy' &&
        redis === 'healthy' &&
        !(firestoreSync.retryingEvents !== null && firestoreSync.retryingEvents > 0)
          ? 'healthy'
          : 'degraded',
      checkedAt: new Date().toISOString(),
      dependencies: { database, redis, firestoreSync },
    };
  }

  async getActivity(page: number, pageSize: number, search?: string) {
    const where: Prisma.PlatformAuditLogWhereInput = search
      ? {
          OR: [
            { action: { contains: search } },
            { targetType: { contains: search } },
            { actor: { email: { contains: search } } },
            { actor: { name: { contains: search } } },
          ],
        }
      : {};

    const [entries, total] = await this.prisma.$transaction([
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          createdAt: true,
          actor: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);

    return { entries, page, pageSize, total };
  }

  async getUsers(page: number, pageSize: number, search?: string) {
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [{ email: { contains: search } }, { name: { contains: search } }],
        }
      : {};

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          platformRole: true,
          createdAt: true,
          _count: {
            select: {
              ownedWorkspaces: true,
              memberships: true,
              projects: true,
              tasks: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      entries: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        platformRole: u.platformRole,
        createdAt: u.createdAt,
        counts: {
          workspaces: u._count.ownedWorkspaces,
          memberships: u._count.memberships,
          projects: u._count.projects,
          tasks: u._count.tasks,
        },
      })),
      page,
      pageSize,
      total,
    };
  }

  async updateUserRole(actorId: string, targetUserId: string, newRole: PlatformRole | null) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, name: true, platformRole: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Utilisateur cible introuvable.');
    }

    if (
      actorId === targetUserId &&
      targetUser.platformRole === PlatformRole.SUPER_ADMIN &&
      newRole !== PlatformRole.SUPER_ADMIN
    ) {
      const superAdminCount = await this.prisma.user.count({
        where: { platformRole: PlatformRole.SUPER_ADMIN },
      });
      if (superAdminCount <= 1) {
        throw new ForbiddenException(
          'Impossible de rétrograder le dernier Super Administrateur de la plateforme.',
        );
      }
    }

    const previousRole = targetUser.platformRole;
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { platformRole: newRole },
      select: { id: true, email: true, name: true, platformRole: true },
    });

    await this.prisma.platformAuditLog.create({
      data: {
        actorId,
        action: 'USER_ROLE_UPDATED',
        targetType: 'User',
        targetId: targetUserId,
        metadata: {
          targetEmail: targetUser.email,
          previousRole,
          newRole,
        },
      },
    });

    return {
      message: `Rôle mis à jour avec succès pour ${targetUser.email}`,
      user: updated,
    };
  }

  async revokeUserSessions(actorId: string, targetUserId: string) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Utilisateur cible introuvable.');
    }

    const deleted = await this.prisma.refreshToken.deleteMany({
      where: { userId: targetUserId },
    });

    await this.prisma.platformAuditLog.create({
      data: {
        actorId,
        action: 'USER_SESSIONS_REVOKED',
        targetType: 'User',
        targetId: targetUserId,
        metadata: {
          targetEmail: targetUser.email,
          revokedTokensCount: deleted.count,
        },
      },
    });

    return {
      message: `Toutes les sessions de ${targetUser.email} ont été révoquées (${deleted.count} jetons supprimés).`,
      revokedCount: deleted.count,
    };
  }

  async impersonateUser(actorId: string, targetUserId: string) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, name: true, platformRole: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Utilisateur cible introuvable.');
    }

    const payload = {
      sub: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      impersonatedBy: actorId,
    };
    const accessToken = this.tokenService.signAccessToken(payload);

    await this.prisma.platformAuditLog.create({
      data: {
        actorId,
        action: 'USER_IMPERSONATED',
        targetType: 'User',
        targetId: targetUserId,
        metadata: {
          targetEmail: targetUser.email,
          impersonatedAt: new Date().toISOString(),
        },
      },
    });

    return {
      message: `Connexion temporaire sous l'identité de ${targetUser.email}`,
      accessToken,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        platformRole: targetUser.platformRole,
      },
    };
  }

  async getWorkspaces(page: number, pageSize: number, search?: string) {
    const where: Prisma.WorkspaceWhereInput = search
      ? {
          name: { contains: search },
        }
      : {};

    const [workspaces, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          createdAt: true,
          deletedAt: true,
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              memberships: true,
              projects: true,
              teams: true,
            },
          },
        },
      }),
      this.prisma.workspace.count({ where }),
    ]);

    return {
      entries: workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        createdAt: w.createdAt,
        deletedAt: w.deletedAt,
        owner: w.owner,
        counts: {
          members: w._count.memberships,
          projects: w._count.projects,
          teams: w._count.teams,
        },
      })),
      page,
      pageSize,
      total,
    };
  }

  private async checkDependency(
    name: 'database' | 'redis',
    check: () => Promise<void>,
  ): Promise<'healthy' | 'unavailable'> {
    try {
      await check();
      return 'healthy';
    } catch (error) {
      this.logger.error(
        `La vérification de santé de ${name} a échoué.`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'unavailable';
    }
  }
}
