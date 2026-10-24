import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService.register', () => {
  let service: AuthService;

  const transaction = {
    user: { create: jest.fn() },
    workspace: { create: jest.fn() },
    membership: { create: jest.fn() },
    project: { create: jest.fn() },
    task: { create: jest.fn() },
    taskDependency: { create: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const jwtService = { sign: jest.fn().mockReturnValue('signed-token') };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it("annule l'inscription si la création des données d'onboarding échoue", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback) => callback(transaction));
    transaction.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
    });
    transaction.workspace.create.mockRejectedValue(new Error('Database unavailable'));

    await expect(service.register('ada@example.com', 'StrongPassword1!', 'Ada')).rejects.toThrow(
      'Database unavailable',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.workspace.create).toHaveBeenCalledTimes(1);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('crée le compte et ses données initiales dans une transaction unique', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback) => callback(transaction));
    transaction.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
    });
    transaction.workspace.create.mockResolvedValue({ id: 'workspace-1' });
    transaction.project.create.mockResolvedValue({ id: 'project-1' });
    transaction.task.create
      .mockResolvedValueOnce({ id: 'task-1' })
      .mockResolvedValueOnce({ id: 'task-2' })
      .mockResolvedValueOnce({ id: 'task-3' })
      .mockResolvedValueOnce({ id: 'task-4' });

    const result = await service.register('ada@example.com', 'StrongPassword1!', 'Ada');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.membership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: 'workspace-1', userId: 'user-1' }),
      }),
    );
    expect(transaction.taskDependency.create).toHaveBeenCalledTimes(1);
    expect(result.accessToken).toBe('signed-token');
  });

  it('refuse les champs obligatoires manquants avant toute transaction', async () => {
    await expect(service.register('', 'password', 'Ada')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
