import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';
import { AdminService } from './admin.service';
import { SessionService } from '../auth/session.service';
import { AuthService } from '../auth/auth.service';

describe('AdminService', () => {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    user: { count: jest.fn(), findUnique: jest.fn() },
    workspace: { count: jest.fn() },
    project: { count: jest.fn() },
    task: { count: jest.fn() },
    notification: { count: jest.fn() },
    platformAuditLog: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    refreshToken: { deleteMany: jest.fn() },
  };
  const redis = { ping: jest.fn() };
  const firestoreSync = { getStatus: jest.fn() };
  const sessionService = { revokeAllForUser: jest.fn() };
  const authService = { completeLogin: jest.fn() };
  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      firestoreSync as unknown as FirestoreSyncService,
      sessionService as unknown as SessionService,
      authService as unknown as AuthService,
    );
    firestoreSync.getStatus.mockResolvedValue({
      state: 'disabled',
      pendingEvents: null,
      retryingEvents: null,
      oldestPendingAt: null,
    });
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
      dependencies: {
        database: 'healthy',
        redis: 'unavailable',
        firestoreSync: { state: 'disabled' },
      },
    });
    expect(loggerSpy).toHaveBeenCalledWith(
      'La vérification de santé de redis a échoué.',
      expect.any(String),
    );
    loggerSpy.mockRestore();
  });

  it('degrades health when Firestore mirror events are retrying', async () => {
    prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    redis.ping.mockResolvedValue('PONG');
    firestoreSync.getStatus.mockResolvedValue({
      state: 'active',
      pendingEvents: 2,
      retryingEvents: 1,
      oldestPendingAt: '2026-10-26T03:00:00.000Z',
    });

    await expect(service.getHealth()).resolves.toMatchObject({
      status: 'degraded',
      dependencies: {
        firestoreSync: {
          state: 'active',
          pendingEvents: 2,
          retryingEvents: 1,
        },
      },
    });
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

  // S7 : la révocation administrative coupe réellement les sessions (et n'est plus un deleteMany factice)
  it('revokeUserSessions révoque les sessions via SessionService et journalise le nombre réel', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-2', email: 'cible@example.com' });
    sessionService.revokeAllForUser.mockResolvedValue(3);

    const result = await service.revokeUserSessions('admin-1', 'u-2');

    expect(sessionService.revokeAllForUser).toHaveBeenCalledWith('u-2');
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(result.revokedCount).toBe(3);
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'USER_SESSIONS_REVOKED',
        metadata: expect.objectContaining({ revokedSessionsCount: 3 }),
      }),
    });
  });

  it('impersonateUser émet la session par AuthService.completeLogin (15 min, sans refresh)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-2',
      email: 'cible@example.com',
      name: 'Cible',
      platformRole: null,
    });
    authService.completeLogin.mockResolvedValue({
      user: { id: 'u-2', email: 'cible@example.com', name: 'Cible', platformRole: null },
      session: { sid: 's', accessToken: 'jeton', accessMaxAgeSeconds: 900 },
    });

    const result = await service.impersonateUser('admin-1', 'u-2');

    expect(authService.completeLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-2' }), {
      impersonatedBy: 'admin-1',
      method: 'impersonation',
    });
    expect(result).not.toHaveProperty('accessToken');
  });
});
