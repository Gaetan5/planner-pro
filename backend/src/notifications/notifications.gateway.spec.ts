import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { TokenService } from '../auth/token.service';

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
      handshake: { auth: { token: tokenService.signAccessToken({ sub: 'user-1' }) }, headers: {} },
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
});
