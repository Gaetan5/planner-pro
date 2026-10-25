import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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
    const [database, redis] = await Promise.all([
      this.checkDependency('database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.checkDependency('redis', async () => {
        await this.redis.ping();
      }),
    ]);

    return {
      status: database === 'healthy' && redis === 'healthy' ? 'healthy' : 'degraded',
      checkedAt: new Date().toISOString(),
      dependencies: { database, redis },
    };
  }

  async getActivity(page: number, pageSize: number) {
    const [entries, total] = await this.prisma.$transaction([
      this.prisma.platformAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          createdAt: true,
          actor: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.platformAuditLog.count(),
    ]);

    return { entries, page, pageSize, total };
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
