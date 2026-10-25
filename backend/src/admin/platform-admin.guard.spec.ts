import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAdminGuard } from './platform-admin.guard';

describe('PlatformAdminGuard', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  let guard: PlatformAdminGuard;

  const contextFor = (user?: { id: string }) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new PlatformAdminGuard(prisma as unknown as PrismaService);
  });

  it('allows a user with a platform role', async () => {
    prisma.user.findUnique.mockResolvedValue({ platformRole: 'SUPER_ADMIN' });

    await expect(guard.canActivate(contextFor({ id: 'admin-1' }))).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      select: { platformRole: true },
    });
  });

  it('denies regular users without a platform role', async () => {
    prisma.user.findUnique.mockResolvedValue({ platformRole: null });

    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects requests without an authenticated user id', async () => {
    await expect(guard.canActivate(contextFor())).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
