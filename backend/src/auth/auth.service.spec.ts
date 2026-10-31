import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseIdentityService } from './firebase-identity.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';

describe('AuthService', () => {
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
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    authToken: { updateMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const sessionService = {
    issue: jest.fn().mockResolvedValue({ sid: 'sid-1', accessToken: 'signed-token' }),
  };
  const firebaseIdentity = { verifyIdToken: jest.fn() };
  const mail = {
    sendEmailVerificationEmail: jest.fn().mockResolvedValue(true),
    sendAccountExistsEmail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirebaseIdentityService, useValue: firebaseIdentity },
        { provide: TokenService, useValue: {} },
        { provide: SessionService, useValue: sessionService },
        { provide: MailService, useValue: mail },
        { provide: RedisService, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
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
    expect(sessionService.issue).not.toHaveBeenCalled();
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
    // P6 : réponse générique, aucune session avant la vérification de l'adresse
    expect(result).toEqual({ message: expect.any(String) });
    expect(sessionService.issue).not.toHaveBeenCalled();
    expect(mail.sendEmailVerificationEmail).toHaveBeenCalledWith(
      'ada@example.com',
      expect.any(String),
    );
  });

  it('refuse les champs obligatoires manquants avant toute transaction', async () => {
    await expect(service.register('', 'password', 'Ada')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('isole chaque session de démonstration dans un compte distinct', async () => {
    prisma.user.create
      .mockResolvedValueOnce({ id: 'demo-1', email: 'demo-1@local.planner.pro', name: 'Ada' })
      .mockResolvedValueOnce({ id: 'demo-2', email: 'demo-2@local.planner.pro', name: 'Ada' });

    await service.mockLogin('Ada');
    await service.mockLogin('Ada');

    const [firstCall, secondCall] = prisma.user.create.mock.calls;
    expect(firstCall[0].data.email).not.toBe(secondCall[0].data.email);
    expect(firstCall[0].data.githubId).not.toBe(secondCall[0].data.githubId);
    expect(prisma.user.create).toHaveBeenCalledTimes(2);
  });

  it('S8 : refuse la liaison automatique d’une identité Firebase à un compte existant (409)', async () => {
    firebaseIdentity.verifyIdToken.mockResolvedValue({
      uid: 'firebase-1',
      email: 'ada@example.com',
      email_verified: true,
      name: 'Ada',
    });
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'legacy-1',
      email: 'ada@example.com',
      name: 'Ada',
      firebaseUid: null,
    });

    await expect(service.loginWithFirebase('firebase-token')).rejects.toThrow(ConflictException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(sessionService.issue).not.toHaveBeenCalled();
  });

  it('refuse de lier un compte existant avec une adresse Firebase non vérifiée', async () => {
    firebaseIdentity.verifyIdToken.mockResolvedValue({
      uid: 'firebase-1',
      email: 'ada@example.com',
      email_verified: false,
    });

    await expect(service.loginWithFirebase('firebase-token')).rejects.toThrow(
      'Une adresse e-mail Firebase vérifiée est requise.',
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('crée le compte MySQL et ses données initiales pour une nouvelle identité Firebase', async () => {
    firebaseIdentity.verifyIdToken.mockResolvedValue({
      uid: 'firebase-2',
      email: 'grace@example.com',
      email_verified: true,
      name: 'Grace Hopper',
    });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback) => callback(transaction));
    transaction.user.create.mockResolvedValue({
      id: 'firebase-user-1',
      email: 'grace@example.com',
      name: 'Grace Hopper',
    });
    transaction.workspace.create.mockResolvedValue({ id: 'workspace-1' });
    transaction.task.create
      .mockResolvedValueOnce({ id: 'task-1' })
      .mockResolvedValueOnce({ id: 'task-2' })
      .mockResolvedValueOnce({ id: 'task-3' })
      .mockResolvedValueOnce({ id: 'task-4' });

    const result = await service.loginWithFirebase('firebase-token');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        email: 'grace@example.com',
        name: 'Grace Hopper',
        firebaseUid: 'firebase-2',
        emailVerifiedAt: expect.any(Date),
      },
    });
    expect('user' in result && result.user.id).toBe('firebase-user-1');
  });

  describe('linkFirebaseAccount', () => {
    it('associe de manière vérifiée un UID Firebase à un compte utilisateur existant', async () => {
      firebaseIdentity.verifyIdToken.mockResolvedValue({
        uid: 'firebase-linked-1',
        email: 'ada@example.com',
        email_verified: true,
      });
      prisma.user.findUnique.mockResolvedValue(null); // aucun autre utilisateur avec cet UID
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'ada@example.com',
        name: 'Ada',
        firebaseUid: 'firebase-linked-1',
        platformRole: 'USER',
      });

      const res = await service.linkFirebaseAccount('user-1', 'valid-firebase-token');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firebaseUid: 'firebase-linked-1' },
        select: expect.any(Object),
      });
      expect(res.user.firebaseUid).toBe('firebase-linked-1');
    });

    it('refuse si l’adresse email Firebase n’est pas vérifiée', async () => {
      firebaseIdentity.verifyIdToken.mockResolvedValue({
        uid: 'firebase-linked-1',
        email: 'ada@example.com',
        email_verified: false,
      });

      await expect(service.linkFirebaseAccount('user-1', 'unverified-token')).rejects.toThrow(
        'Une adresse e-mail Firebase vérifiée est requise.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuse si le compte Firebase est déjà lié à un autre utilisateur', async () => {
      firebaseIdentity.verifyIdToken.mockResolvedValue({
        uid: 'firebase-linked-1',
        email: 'other@example.com',
        email_verified: true,
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'other-user-99',
        firebaseUid: 'firebase-linked-1',
      });

      await expect(service.linkFirebaseAccount('user-1', 'conflict-token')).rejects.toThrow(
        'Cet identifiant Firebase est déjà lié à un autre compte.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
