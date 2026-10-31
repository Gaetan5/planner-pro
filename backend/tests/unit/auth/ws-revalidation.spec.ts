import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { SessionService } from '../../../src/auth/session.service';
import { TokenService } from '../../../src/auth/token.service';
import { authenticateSocket, stopSessionWatch } from '../../../src/auth/ws-auth';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';
import { FakePrisma } from '../../http/fake-prisma';
import { FakeRedisService } from '../../http/fake-redis';

/** S7-a : la revalidation périodique d'une socket ne passe pas par le cache de 60 s. */
describe('S7-a : revalidation des sockets sans cache', () => {
  const savedEnv = { ...process.env };
  let sessions: SessionService;
  let prisma: FakePrisma;
  let redis: FakeRedisService;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret-s7a-0123456789abcdef0123456789';
    prisma = new FakePrisma();
    redis = new FakeRedisService();
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      providers: [
        SessionService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    sessions = module.get(SessionService);
    await prisma.user.create({ data: { id: 'u1', email: 'a@b.co', name: 'A' } });
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...savedEnv };
  });

  it('suspension posée en base alors que le cache dit « actif » : socket coupée au premier tick', async () => {
    const issued = await sessions.issue({ id: 'u1', email: 'a@b.co', name: 'A' });
    jest.useFakeTimers();
    const client = {
      handshake: { auth: { token: issued.accessToken }, headers: {} },
      data: {} as Record<string, unknown>,
      disconnect: jest.fn(),
    } as unknown as Socket;
    await authenticateSocket(client, sessions);

    // Une requête HTTP remplit le cache 1 s après la connexion : il reste valide au premier tick
    await jest.advanceTimersByTimeAsync(1_000);
    redis.store.clear();
    await sessions.verifyAccess(issued.accessToken);
    expect(redis.store.size).toBeGreaterThan(0);

    // Suspension directe en base, sans passer par `revoke` (le cache n'est pas invalidé)
    await prisma.user.update({ where: { id: 'u1' }, data: { isSuspended: true } });

    await jest.advanceTimersByTimeAsync(59_000);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    stopSessionWatch(client);
  });

  it('session saine : socket conservée, cache rafraîchi', async () => {
    const issued = await sessions.issue({ id: 'u1', email: 'a@b.co', name: 'A' });
    jest.useFakeTimers();
    const client = {
      handshake: { auth: { token: issued.accessToken }, headers: {} },
      data: {} as Record<string, unknown>,
      disconnect: jest.fn(),
    } as unknown as Socket;
    await authenticateSocket(client, sessions);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(client.disconnect).not.toHaveBeenCalled();
    stopSessionWatch(client);
  });
});
