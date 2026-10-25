import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    user: { count: jest.fn() },
    workspace: { count: jest.fn() },
    project: { count: jest.fn() },
    task: { count: jest.fn() },
    notification: { count: jest.fn() },
    platformAuditLog: { findMany: jest.fn(), count: jest.fn() },
  };
  const redis = { ping: jest.fn() };
  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(prisma as unknown as PrismaService, redis as unknown as RedisService);
  });

  it('returns only aggregated platform totals', async () => {
    prisma.$transaction.mockResolvedValue([3, 2, 4, 12, 8]);

    const overview = await service.getOverview();

    expect(overview.totals).toEqual({
      users: 3,
      workspaces: 2,
      projects: 4,
      tasks: 12,
      notifications: 8,
    });
    expect(overview.generatedAt).toEqual(expect.any(String));
  });

  it('reports database and Redis state without hiding a failed dependency', async () => {
    prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    redis.ping.mockRejectedValue(new Error('Redis unavailable'));
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const health = await service.getHealth();

    expect(health).toMatchObject({
      status: 'degraded',
      dependencies: { database: 'healthy', redis: 'unavailable' },
    });
    expect(loggerSpy).toHaveBeenCalledWith(
      'La vérification de santé de redis a échoué.',
      expect.any(String),
    );
    loggerSpy.mockRestore();
  });

  it('returns a bounded activity page with its total count', async () => {
    const entries = [{ id: 'audit-1', action: 'platform.admin.bootstrap' }];
    prisma.$transaction.mockResolvedValue([entries, 1]);

    await expect(service.getActivity(2, 20)).resolves.toEqual({
      entries,
      page: 2,
      pageSize: 20,
      total: 1,
    });
    expect(prisma.platformAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });
});
