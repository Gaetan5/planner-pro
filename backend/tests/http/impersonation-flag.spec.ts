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
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';
import { startHttpTestApp } from './http-test-app';

/**
 * S18, étape 0 : impersonation derrière FEATURE_IMPERSONATION_ENABLED (désactivée par défaut).
 */
describe('S18 étape 0 : drapeau FEATURE_IMPERSONATION_ENABLED (HTTP)', () => {
  const JWT_SECRET = 'test-secret-s18-impersonation-0123456789';
  let app: INestApplication;
  let baseUrl: string;
  let adminToken: string;
  const savedEnv = { ...process.env };

  const adminService = {
    impersonateUser: jest.fn().mockResolvedValue({
      session: { accessToken: 'jeton', accessMaxAgeSeconds: 900, sid: 'imp-sid' },
      user: { id: 'u-2' },
    }),
    getOverview: jest.fn().mockResolvedValue({ totals: {} }),
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ platformRole: 'SUPER_ADMIN' }) },
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const jwtService = new JwtService({ secret: JWT_SECRET });
    ({ app, baseUrl } = await startHttpTestApp({
      controllers: [AdminController, AppController],
      providers: [
        AppService,
        { provide: AdminService, useValue: adminService },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        TokenService,
        {
          provide: SessionService,
          useFactory: (tokens: TokenService) => sessionServiceStub(tokens),
          inject: [TokenService],
        },
        JwtAuthGuard,
        PlatformAdminGuard,
      ],
    }));
    adminToken = new TokenService(jwtService).signAccessToken({ sub: 'admin-1', sid: STUB_SID });
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FEATURE_IMPERSONATION_ENABLED;
  });

  const impersonate = (token?: string) =>
    fetch(`${baseUrl}/admin/users/u-2/impersonate`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  it('drapeau absent : 404 pour un SUPER_ADMIN, aucun jeton émis', async () => {
    const res = await impersonate(adminToken);
    expect(res.status).toBe(404);
    expect(adminService.impersonateUser).not.toHaveBeenCalled();
  });

  it('drapeau absent : 404 avant toute authentification', async () => {
    const res = await impersonate();
    expect(res.status).toBe(404);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("drapeau à 'true' : la route est servie (toujours derrière l'authentification admin)", async () => {
    process.env.FEATURE_IMPERSONATION_ENABLED = 'true';
    expect((await impersonate()).status).toBe(401);
    const res = await impersonate(adminToken);
    expect(res.status).toBe(201);
    expect(adminService.impersonateUser).toHaveBeenCalledWith('admin-1', 'u-2');
  });

  it('les autres routes admin ne dépendent pas du drapeau', async () => {
    const res = await fetch(`${baseUrl}/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('GET /features expose impersonation', async () => {
    expect(await (await fetch(`${baseUrl}/features`)).json()).toEqual(
      expect.objectContaining({ impersonation: false }),
    );
    process.env.FEATURE_IMPERSONATION_ENABLED = 'true';
    expect(await (await fetch(`${baseUrl}/features`)).json()).toEqual(
      expect.objectContaining({ impersonation: true }),
    );
  });
});
