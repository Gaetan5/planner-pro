import { INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { SessionService } from '../../src/auth/session.service';
import { TokenModule } from '../../src/auth/token.module';
import { InvitationsController } from '../../src/projects/invitations.controller';
import { InvitationsService } from '../../src/projects/invitations.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { FakePrisma } from './fake-prisma';
import { FakeRedisService } from './fake-redis';
import { startHttpTestApp } from './http-test-app';

/** S27 (non bloquant r30) : le jeton d'invitation est dans le corps de `check` et `accept`. */
describe('Invitations : jeton dans le corps, plus dans le chemin (S27)', () => {
  const JWT_SECRET = 'test-secret-s27-invitation-0123456789abcdef012';
  const VALID = 'ab12'.repeat(16);
  let app: INestApplication;
  let baseUrl: string;
  let token: string;
  const prisma = new FakePrisma();
  const service = {
    checkInvitation: jest.fn(),
    validateAndAcceptInvitation: jest.fn(),
  };
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    ({ app, baseUrl } = await startHttpTestApp({
      imports: [JwtModule.register({ global: true, secret: JWT_SECRET }), TokenModule],
      controllers: [InvitationsController],
      providers: [
        JwtAuthGuard,
        SessionService,
        { provide: InvitationsService, useValue: service },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: new FakeRedisService() },
      ],
    }));
    await prisma.user.create({ data: { id: 'u-1', email: 'ada@corp.com', name: 'Ada' } });
    token = (await app.get(SessionService).issue({ id: 'u-1', email: 'ada@corp.com', name: 'Ada' }))
      .accessToken;
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service.checkInvitation.mockResolvedValue({ valid: true });
    service.validateAndAcceptInvitation.mockResolvedValue({ ok: true });
  });

  const post = (path: string, body: unknown, auth?: string) =>
    fetch(`${baseUrl}/projects/invitations/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(body),
    });

  describe('check (public)', () => {
    it('jeton valide dans le corps : 200, sans session, le service reçoit le jeton', async () => {
      const res = await post('check', { token: VALID });
      expect(res.status).toBe(200);
      expect(service.checkInvitation).toHaveBeenCalledWith(VALID);
    });

    it.each([
      ['absent', {}],
      ['objet d’opérateurs', { token: { not: '' } }],
      ['remontée de chemin', { token: '../../auth/logout' }],
      ['majuscules', { token: VALID.toUpperCase() }],
      ['trop court', { token: 'ab12' }],
      ['trop long', { token: `${VALID}00` }],
    ])('jeton %s : 400, le service n’est pas appelé', async (_label, body) => {
      expect((await post('check', body)).status).toBe(400);
      expect(service.checkInvitation).not.toHaveBeenCalled();
    });

    it('l’ancienne route GET avec le jeton dans le chemin n’existe plus', async () => {
      expect((await fetch(`${baseUrl}/projects/invitations/check/${VALID}`)).status).toBe(404);
      expect(service.checkInvitation).not.toHaveBeenCalled();
    });
  });

  describe('accept (authentifié)', () => {
    it('jeton valide, session valide : 200, le service reçoit le jeton et l’utilisateur', async () => {
      const res = await post('accept', { token: VALID }, token);
      expect(res.status).toBe(200);
      expect(service.validateAndAcceptInvitation).toHaveBeenCalledWith(
        VALID,
        expect.objectContaining({ id: 'u-1' }),
      );
    });

    it('sans session : 401, le service n’est pas appelé', async () => {
      expect((await post('accept', { token: VALID })).status).toBe(401);
      expect(service.validateAndAcceptInvitation).not.toHaveBeenCalled();
    });

    it.each([
      ['absent', {}],
      ['remontée de chemin', { token: '../../auth/logout' }],
      ['majuscules', { token: VALID.toUpperCase() }],
    ])('jeton %s : 400, le service n’est pas appelé', async (_label, body) => {
      expect((await post('accept', body, token)).status).toBe(400);
      expect(service.validateAndAcceptInvitation).not.toHaveBeenCalled();
    });

    it('l’ancienne route POST avec le jeton dans le chemin n’existe plus', async () => {
      const res = await fetch(`${baseUrl}/projects/invitations/accept/${VALID}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
      expect(service.validateAndAcceptInvitation).not.toHaveBeenCalled();
    });
  });
});
