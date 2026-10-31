import { UnauthorizedException } from '@nestjs/common';
import { Socket } from 'socket.io';
import { Request, Response } from 'express';
import { authenticateSocket } from '../../../src/auth/ws-auth';
import {
  parseCookieHeader,
  readAccessCookie,
  readRefreshCookie,
  setSessionCookies,
} from '../../../src/auth/session-cookies';

/** S29 : handshake WebSocket par cookie et préfixes de cookies. */
describe('S29 : handshake WebSocket', () => {
  const saved = { ...process.env };
  const sessions = {
    verifyAccess: jest.fn().mockResolvedValue({ sub: 'u1', sid: 's1' }),
    isSessionActive: jest.fn().mockResolvedValue(true),
  };
  const socket = (headers: Record<string, string>, auth: Record<string, string> = {}) =>
    ({
      handshake: { auth, headers },
      data: {} as Record<string, unknown>,
      disconnect: jest.fn(),
    }) as unknown as Socket;

  beforeEach(() => {
    process.env.CORS_ORIGINS = 'https://app.boukarou-os.com';
    sessions.verifyAccess.mockClear();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('cookie + Origin étrangère : handshake refusé, jeton non examiné', async () => {
    const client = socket({ cookie: 'accessToken=jwt', origin: 'https://evil.boukarou-os.com' });
    await expect(authenticateSocket(client, sessions as never)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.verifyAccess).not.toHaveBeenCalled();
  });

  it('cookie sans Origin : refusé', async () => {
    await expect(
      authenticateSocket(socket({ cookie: 'accessToken=jwt' }), sessions as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('cookie + Origin autorisée : accepté', async () => {
    const client = socket({ cookie: 'accessToken=jwt', origin: 'https://app.boukarou-os.com' });
    await authenticateSocket(client, sessions as never);
    expect(client.data.userId).toBe('u1');
    clearInterval(client.data.sessionWatch as NodeJS.Timeout);
  });

  it('Authorization Bearer sans Origin : accepté (clients non navigateur)', async () => {
    const client = socket({ authorization: 'Bearer jwt' });
    await authenticateSocket(client, sessions as never);
    expect(sessions.verifyAccess).toHaveBeenCalledWith('jwt');
    clearInterval(client.data.sessionWatch as NodeJS.Timeout);
  });
});

describe('S29 : préfixes et doublons de cookies', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const fakeRes = () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    return {
      calls,
      cookie: (n: string, v: string, o: Record<string, unknown>) => calls.push([n, v, o]),
      clearCookie: jest.fn(),
    };
  };

  it('production : __Host- (Secure, Path=/, sans Domain) pour l’accès, __Secure- pour le refresh', () => {
    process.env.NODE_ENV = 'production';
    const res = fakeRes();
    setSessionCookies(res as unknown as Response, {
      accessToken: 'a',
      accessMaxAgeSeconds: 900,
      refreshToken: 'r',
      refreshMaxAgeSeconds: 604800,
    });
    const [access, refresh] = res.calls;
    expect(access[0]).toBe('__Host-accessToken');
    expect(access[2]).toMatchObject({ secure: true, path: '/', httpOnly: true });
    expect(access[2]).not.toHaveProperty('domain');
    expect(refresh[0]).toBe('__Secure-refreshToken');
    expect(refresh[2]).toMatchObject({ secure: true, path: '/auth' });
  });

  it('hors production : noms simples', () => {
    process.env.NODE_ENV = 'development';
    const res = fakeRes();
    setSessionCookies(res as unknown as Response, { accessToken: 'a', accessMaxAgeSeconds: 900 });
    expect(res.calls[0][0]).toBe('accessToken');
  });

  it('production : le cookie sans préfixe (déposé par un voisin) n’est pas lu', () => {
    process.env.NODE_ENV = 'production';
    const req = {
      headers: { cookie: 'accessToken=evil; refreshToken=evil' },
    } as unknown as Request;
    expect(readAccessCookie(req)).toBeUndefined();
    expect(readRefreshCookie(req)).toBeUndefined();
    const ok = { headers: { cookie: '__Host-accessToken=good' } } as unknown as Request;
    expect(readAccessCookie(ok)).toBe('good');
  });

  it('deux valeurs pour le même cookie : refusé', () => {
    expect(parseCookieHeader('refreshToken=a; refreshToken=b', 'refreshToken')).toBeUndefined();
    expect(parseCookieHeader('refreshToken=a', 'refreshToken')).toBe('a');
  });
});
