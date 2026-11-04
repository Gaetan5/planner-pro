import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Reflector } from '@nestjs/core';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformRoles } from './platform-roles.decorator';

describe('PlatformAdminGuard', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  let guard: PlatformAdminGuard;

  class Ctrl {
    @PlatformRoles('SUPER_ADMIN')
    superOnly() {}
    open() {}
  }
  const contextFor = (user?: { id: string }, handler: () => void = Ctrl.prototype.open) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => handler,
      getClass: () => Ctrl,
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new PlatformAdminGuard(prisma as unknown as PrismaService, new Reflector());
  });

  it('allows a user with a platform role', async () => {
    prisma.user.findUnique.mockResolvedValue({ platformRole: 'SUPER_ADMIN', mfaEnabled: true });

    await expect(guard.canActivate(contextFor({ id: 'admin-1' }))).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      select: { platformRole: true, mfaEnabled: true },
    });
  });

  it('denies regular users without a platform role', async () => {
    prisma.user.findUnique.mockResolvedValue({ platformRole: null, mfaEnabled: true });

    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects requests without an authenticated user id', async () => {
    await expect(guard.canActivate(contextFor())).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('S18.3 : refuse un compte de plateforme sans MFA', async () => {
    prisma.user.findUnique.mockResolvedValue({ platformRole: 'SUPER_ADMIN', mfaEnabled: false });

    await expect(guard.canActivate(contextFor({ id: 'admin-1' }))).rejects.toThrow(/deux facteurs/);
  });

  it('S18.1 : une route @PlatformRoles(SUPER_ADMIN) refuse un PLATFORM_ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({ platformRole: 'PLATFORM_ADMIN', mfaEnabled: true });

    await expect(
      guard.canActivate(contextFor({ id: 'a' }, Ctrl.prototype.superOnly)),
    ).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(contextFor({ id: 'a' }))).resolves.toBe(true);
  });

  it('S18.1 : une route @PlatformRoles(SUPER_ADMIN) accepte un SUPER_ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({ platformRole: 'SUPER_ADMIN', mfaEnabled: true });

    await expect(
      guard.canActivate(contextFor({ id: 'a' }, Ctrl.prototype.superOnly)),
    ).resolves.toBe(true);
  });
});
