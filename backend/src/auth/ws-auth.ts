import { Socket } from 'socket.io';
import { UnauthorizedException } from '@nestjs/common';
import { SessionService, VerifiedSession } from './session.service';
import { accessCookieName, parseCookieHeader } from './session-cookies';
import { getAllowedOrigins } from './origin-guard';

/** Revalidation périodique d'une socket ouverte : session révoquée ou compte suspendu (S7). */
export const WS_SESSION_REVALIDATION_MS = 60_000;

/**
 * Extrait le jeton d'accès d'un handshake Socket.IO : `auth.token`, en-tête `Authorization`
 * (clients non navigateur), puis cookie httpOnly `accessToken` (navigateur, `withCredentials`).
 */
export function extractSocketToken(client: Socket): { token?: string; fromCookie: boolean } {
  let token = client.handshake.auth?.token || client.handshake.headers?.authorization;
  if (typeof token === 'string' && token.startsWith('Bearer ')) {
    token = token.slice(7);
  }
  if (typeof token === 'string' && token) return { token, fromCookie: false };
  const cookie = parseCookieHeader(client.handshake.headers?.cookie, accessCookieName());
  return { token: cookie, fromCookie: true };
}

/**
 * Authentifie un handshake avec la même vérification que le guard HTTP (typ, sid, session active,
 * compte non suspendu), puis surveille la session tant que la socket reste ouverte.
 */
export async function authenticateSocket(
  client: Socket,
  sessionService: SessionService,
): Promise<VerifiedSession> {
  const { token, fromCookie } = extractSocketToken(client);
  if (!token) {
    throw new UnauthorizedException('Identifiant WebSocket non fourni.');
  }
  // Détournement de WebSocket depuis un sous-domaine voisin (S29) : le cookie part tout seul, donc
  // l'Origin doit être connue. Un jeton explicite (auth.token, Bearer) n'est pas concerné.
  if (fromCookie) {
    const origin = client.handshake.headers?.origin;
    if (typeof origin !== 'string' || !getAllowedOrigins().includes(origin)) {
      throw new UnauthorizedException('Origine WebSocket non autorisée.');
    }
  }
  const payload = await sessionService.verifyAccess(token);
  client.data.userId = payload.sub;
  client.data.sid = payload.sid;

  // On surveille la session (et non le jeton, qui expire en 15 min) : la socket survit au
  // renouvellement du jeton d'accès mais tombe dès que la session est révoquée.
  const timer = setInterval(() => {
    sessionService
      .isSessionActive(payload.sid, payload.sub, { bypassCache: true })
      .then((active) => {
        if (!active) client.disconnect(true);
      })
      .catch(() => client.disconnect(true));
  }, WS_SESSION_REVALIDATION_MS);
  timer.unref?.();
  client.data.sessionWatch = timer;
  return payload;
}

export function stopSessionWatch(client: Socket): void {
  const timer = client.data?.sessionWatch as NodeJS.Timeout | undefined;
  if (timer) clearInterval(timer);
}
