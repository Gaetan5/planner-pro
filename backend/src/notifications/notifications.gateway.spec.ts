import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { TokenService } from '../auth/token.service';
import { SessionService } from '../auth/session.service';
import { STUB_SID, sessionServiceStub } from '../../tests/support/session.test-support';

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;

  const JWT_SECRET = 'test-secret-notifications-gateway-0123456789';
  const jwtService = new JwtService({ secret: JWT_SECRET });
  let tokenService: TokenService;
  const prismaService = { membership: { findMany: jest.fn() } };

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        { provide: JwtService, useValue: jwtService },
        TokenService,
        {
          provide: SessionService,
          useFactory: (tokens: TokenService) => sessionServiceStub(tokens),
          inject: [TokenService],
        },
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    gateway = module.get<NotificationsGateway>(NotificationsGateway);
    tokenService = module.get<TokenService>(TokenService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('journalise la cause et déconnecte le client si le chargement des workspaces échoue', async () => {
    const error = new Error('Database unavailable');
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const client = {
      id: 'socket-1',
      handshake: {
        auth: { token: tokenService.signAccessToken({ sub: 'user-1', sid: STUB_SID }) },
        headers: {},
      },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    prismaService.membership.findMany.mockRejectedValue(error);

    await gateway.handleConnection(client as unknown as Socket);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(loggerSpy).toHaveBeenCalledWith(
      'Socket socket-1 authentication or workspace initialization failed.',
      error.stack,
    );
  });

  // S3 : un ticket MFA ou un jeton sans typ ne doit pas ouvrir de connexion temps réel
  it.each([
    ['ticket MFA', () => tokenService.signMfaTicket('user-1').ticket],
    ['jeton sans typ', () => jwtService.sign({ sub: 'user-1' })],
    ['jeton historique mfaPending', () => jwtService.sign({ sub: 'user-1', mfaPending: true })],
  ])('déconnecte un handshake présentant un %s', async (_label, makeToken) => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const client = {
      id: 'socket-2',
      handshake: { auth: { token: makeToken() }, headers: {} },
      data: {} as Record<string, unknown>,
      join: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(client as unknown as Socket);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.data.userId).toBeUndefined();
    expect(prismaService.membership.findMany).not.toHaveBeenCalled();
  });

  // S7 : cookie httpOnly au handshake, et coupure d'une socket dont la session est révoquée
  describe('session WebSocket (S7)', () => {
    const makeClient = (headers: Record<string, string>) => ({
      id: 'socket-s7',
      handshake: { auth: {}, headers },
      data: {} as Record<string, unknown>,
      join: jest.fn(),
      disconnect: jest.fn(),
    });

    afterEach(() => jest.useRealTimers());

    it('authentifie le handshake par le cookie accessToken (navigateur, withCredentials)', async () => {
      prismaService.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
      const token = tokenService.signAccessToken({ sub: 'user-1', sid: STUB_SID });
      const client = makeClient({
        cookie: `theme=dark; accessToken=${token}`,
        origin: 'http://localhost:3000',
      });

      await gateway.handleConnection(client as unknown as Socket);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      gateway.handleDisconnect(client as unknown as Socket);
    });

    it('déconnecte la socket dans la minute qui suit la révocation de la session', async () => {
      jest.useFakeTimers();
      prismaService.membership.findMany.mockResolvedValue([]);
      const sessions = (gateway as unknown as { sessionService: { isSessionActive: jest.Mock } })
        .sessionService;
      const token = tokenService.signAccessToken({ sub: 'user-1', sid: STUB_SID });
      const client = makeClient({
        cookie: `accessToken=${token}`,
        origin: 'http://localhost:3000',
      });

      await gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).not.toHaveBeenCalled();

      sessions.isSessionActive.mockResolvedValue(false); // logout ou révocation admin
      await jest.advanceTimersByTimeAsync(60_000);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      gateway.handleDisconnect(client as unknown as Socket);
    });

    it('refuse un handshake sans aucun jeton', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const client = makeClient({});
      await gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });
  });
});
