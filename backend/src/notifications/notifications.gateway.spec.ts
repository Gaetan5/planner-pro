import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;

  const jwtService = { verifyAsync: jest.fn() };
  const prismaService = { membership: { findMany: jest.fn() } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    gateway = module.get<NotificationsGateway>(NotificationsGateway);
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
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    prismaService.membership.findMany.mockRejectedValue(error);

    await gateway.handleConnection(client as unknown as Socket);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(loggerSpy).toHaveBeenCalledWith(
      'Socket socket-1 authentication or workspace initialization failed.',
      error.stack,
    );
  });
});
