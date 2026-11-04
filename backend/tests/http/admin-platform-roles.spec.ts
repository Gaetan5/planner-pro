import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminController } from '../../src/admin/admin.controller';
import { AdminService } from '../../src/admin/admin.service';
import { PlatformAdminGuard } from '../../src/admin/platform-admin.guard';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { TokenService } from '../../src/auth/token.service';
import { SessionService } from '../../src/auth/session.service';
import { STUB_SID, sessionServiceStub } from '../support/session.test-support';
import { PrismaService } from '../../src/prisma/prisma.service';
import { startHttpTestApp } from './http-test-app';

/**
 * S18.1 et S18.3 (HTTP réel : routage, guards, pipes) : rôles de plateforme, MFA obligatoire,
 * motif d'impersonation.
 */
describe('S18.1 / S18.3 : console admin (HTTP)', () => {
  const JWT_SECRET = 'test-secret-s18-platform-roles-0123456789';
  let app: INestApplication;
  let baseUrl: string;
  let tokens: TokenService;
  const savedEnv = { ...process.env };

  const adminService = {
    updateUserRole: jest.fn().mockResolvedValue({ message: 'ok' }),
    impersonateUser: jest.fn().mockResolvedValue({
      session: { accessToken: 'jeton', accessMaxAgeSeconds: 900, sid: 'imp-sid' },
      user: { id: 'u-2' },
    }),
    getOverview: jest.fn().mockResolvedValue({ totals: {} }),
    revokeUserSessions: jest.fn().mockResolvedValue({ revokedCount: 1 }),
  };
  // Profil de plateforme par identifiant d'utilisateur
  const profiles: Record<string, { platformRole: string | null; mfaEnabled: boolean }> = {
    'super-1': { platformRole: 'SUPER_ADMIN', mfaEnabled: true },
    'super-nomfa': { platformRole: 'SUPER_ADMIN', mfaEnabled: false },
    'padmin-1': { platformRole: 'PLATFORM_ADMIN', mfaEnabled: true },
    'padmin-nomfa': { platformRole: 'PLATFORM_ADMIN', mfaEnabled: false },
    'user-1': { platformRole: null, mfaEnabled: true },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) => profiles[where.id] ?? null,
      ),
    },
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.FEATURE_IMPERSONATION_ENABLED = 'true';
    const jwtService = new JwtService({ secret: JWT_SECRET });
    ({ app, baseUrl } = await startHttpTestApp({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: adminService },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        TokenService,
        {
          provide: SessionService,
          useFactory: (t: TokenService) => sessionServiceStub(t),
          inject: [TokenService],
        },
        JwtAuthGuard,
        PlatformAdminGuard,
      ],
    }));
    tokens = new TokenService(jwtService);
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  beforeEach(() => jest.clearAllMocks());

  const call = (userId: string, method: string, path: string, body?: Record<string, unknown>) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokens.signAccessToken({ sub: userId, sid: STUB_SID })}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  describe('S18.1 : rôles de plateforme', () => {
    it('PLATFORM_ADMIN qui modifie un rôle : 403, service jamais appelé', async () => {
      const res = await call('padmin-1', 'PATCH', '/admin/users/u-9/role', { role: 'SUPER_ADMIN' });
      expect(res.status).toBe(403);
      expect(adminService.updateUserRole).not.toHaveBeenCalled();
    });

    it('PLATFORM_ADMIN qui impersonne : 403, service jamais appelé', async () => {
      const res = await call('padmin-1', 'POST', '/admin/users/u-2/impersonate', {
        reason: 'Ticket support 4521, reproduction du bug',
      });
      expect(res.status).toBe(403);
      expect(adminService.impersonateUser).not.toHaveBeenCalled();
    });

    it('SUPER_ADMIN : modification de rôle servie', async () => {
      const res = await call('super-1', 'PATCH', '/admin/users/u-9/role', {
        role: 'PLATFORM_ADMIN',
      });
      expect(res.status).toBe(200);
      expect(adminService.updateUserRole).toHaveBeenCalledWith('super-1', 'u-9', 'PLATFORM_ADMIN');
    });

    it('PLATFORM_ADMIN : lecture (overview) et révocation de sessions restent permises', async () => {
      expect((await call('padmin-1', 'GET', '/admin/overview')).status).toBe(200);
      expect((await call('padmin-1', 'POST', '/admin/users/u-2/revoke-sessions')).status).toBe(201);
    });

    it('utilisateur sans rôle de plateforme : 403', async () => {
      expect((await call('user-1', 'GET', '/admin/overview')).status).toBe(403);
    });
  });

  describe('S18.3 : MFA obligatoire pour les rôles de plateforme', () => {
    it.each([
      ['super-nomfa', 'SUPER_ADMIN'],
      ['padmin-nomfa', 'PLATFORM_ADMIN'],
    ])('%s (%s) sans MFA : 403 sur /admin/overview', async (id) => {
      const res = await call(id, 'GET', '/admin/overview');
      expect(res.status).toBe(403);
      expect(await res.text()).toMatch(/authentification à deux facteurs/i);
      expect(adminService.getOverview).not.toHaveBeenCalled();
    });

    it('SUPER_ADMIN sans MFA : même la modification de rôle est refusée', async () => {
      const res = await call('super-nomfa', 'PATCH', '/admin/users/u-9/role', { role: null });
      expect(res.status).toBe(403);
      expect(adminService.updateUserRole).not.toHaveBeenCalled();
    });
  });

  describe('S18.1 / S18.3 : motif d’impersonation', () => {
    it('sans motif : 400', async () => {
      const res = await call('super-1', 'POST', '/admin/users/u-2/impersonate', {});
      expect(res.status).toBe(400);
      expect(adminService.impersonateUser).not.toHaveBeenCalled();
    });

    it('motif trop court (< 10 caractères) ou trop long (> 500) : 400', async () => {
      expect(
        (await call('super-1', 'POST', '/admin/users/u-2/impersonate', { reason: 'court' })).status,
      ).toBe(400);
      expect(
        (
          await call('super-1', 'POST', '/admin/users/u-2/impersonate', {
            reason: 'x'.repeat(501),
          })
        ).status,
      ).toBe(400);
    });

    it('motif valide : servi, avec le motif et la session de l’administrateur transmis', async () => {
      const res = await call('super-1', 'POST', '/admin/users/u-2/impersonate', {
        reason: 'Ticket support 4521, reproduction du bug',
      });
      expect(res.status).toBe(201);
      expect(adminService.impersonateUser).toHaveBeenCalledWith(
        'super-1',
        'u-2',
        'Ticket support 4521, reproduction du bug',
        STUB_SID,
      );
    });
  });
});
