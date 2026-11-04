import { ForbiddenException, Logger } from '@nestjs/common';
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
    user: { count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    workspace: { count: jest.fn() },
    project: { count: jest.fn() },
    task: { count: jest.fn() },
    notification: { count: jest.fn() },
    platformAuditLog: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    refreshToken: { deleteMany: jest.fn() },
  };
  const redis = { ping: jest.fn() };
  const firestoreSync = { getStatus: jest.fn() };
  const sessionService = { revokeAllForUser: jest.fn(), revoke: jest.fn() };
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

  // Profils de plateforme lus par identifiant
  const profiles: Record<string, Record<string, unknown>> = {
    'super-1': { id: 'super-1', email: 's@x.com', name: 'S', platformRole: 'SUPER_ADMIN' },
    'padmin-1': { id: 'padmin-1', email: 'p@x.com', name: 'P', platformRole: 'PLATFORM_ADMIN' },
    'super-2': { id: 'super-2', email: 's2@x.com', name: 'S2', platformRole: 'SUPER_ADMIN' },
    'u-2': { id: 'u-2', email: 'cible@example.com', name: 'Cible', platformRole: null },
  };
  const useProfiles = () =>
    prisma.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => profiles[where.id] ?? null,
    );
  const REASON = 'Ticket support 4521, reproduction du bug';

  describe('S18.1 : updateUserRole', () => {
    beforeEach(useProfiles);

    it('PLATFORM_ADMIN : 403, aucune écriture ni journal', async () => {
      await expect(
        service.updateUserRole('padmin-1', 'u-2', 'SUPER_ADMIN' as never),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.platformAuditLog.create).not.toHaveBeenCalled();
    });

    it('PLATFORM_ADMIN qui se promeut lui-même SUPER_ADMIN : 403', async () => {
      await expect(
        service.updateUserRole('padmin-1', 'padmin-1', 'SUPER_ADMIN' as never),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('SUPER_ADMIN qui modifie son propre rôle : 403', async () => {
      await expect(service.updateUserRole('super-1', 'super-1', null)).rejects.toThrow(
        /propre rôle/,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('SUPER_ADMIN qui modifie le rôle d’un autre compte : accepté et journalisé', async () => {
      prisma.user.update.mockResolvedValue({ ...profiles['u-2'], platformRole: 'PLATFORM_ADMIN' });
      await service.updateUserRole('super-1', 'u-2', 'PLATFORM_ADMIN' as never);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { platformRole: 'PLATFORM_ADMIN' } }),
      );
      expect(prisma.platformAuditLog.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('S18 : impersonateUser', () => {
    beforeEach(() => {
      useProfiles();
      authService.completeLogin.mockResolvedValue({
        user: { id: 'u-2', email: 'cible@example.com', name: 'Cible', platformRole: null },
        session: { sid: 'imp-sid', accessToken: 'jeton', accessMaxAgeSeconds: 900 },
      });
    });

    it('émet la session par AuthService.completeLogin (15 min, sans refresh), sans jeton dans le résultat', async () => {
      const result = await service.impersonateUser('super-1', 'u-2', REASON, 'admin-sid');

      expect(authService.completeLogin).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u-2' }),
        { impersonatedBy: 'super-1', method: 'impersonation' },
      );
      expect(result).not.toHaveProperty('accessToken');
    });

    it('PLATFORM_ADMIN : 403, aucune session émise', async () => {
      await expect(service.impersonateUser('padmin-1', 'u-2', REASON, 'sid')).rejects.toThrow(
        ForbiddenException,
      );
      expect(authService.completeLogin).not.toHaveBeenCalled();
    });

    it.each(['super-2', 'padmin-1', 'super-1'])(
      'cible %s (compte de plateforme, soi-même compris) : 403, aucune session émise',
      async (target) => {
        await expect(service.impersonateUser('super-1', target, REASON, 'sid')).rejects.toThrow(
          ForbiddenException,
        );
        expect(authService.completeLogin).not.toHaveBeenCalled();
        expect(sessionService.revoke).not.toHaveBeenCalled();
      },
    );

    it('le motif et la session d’impersonation sont consignés dans le journal de la plateforme', async () => {
      await service.impersonateUser('super-1', 'u-2', REASON, 'admin-sid');
      expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 'super-1',
          action: 'USER_IMPERSONATED',
          metadata: expect.objectContaining({ reason: REASON, impersonationSessionId: 'imp-sid' }),
        }),
      });
    });

    it('la session de l’administrateur est révoquée (S18.3), pas celle de la cible', async () => {
      await service.impersonateUser('super-1', 'u-2', REASON, 'admin-sid');
      expect(sessionService.revoke).toHaveBeenCalledTimes(1);
      expect(sessionService.revoke).toHaveBeenCalledWith('admin-sid');
    });
  });
});
