import { Request, Response } from 'express';

/**
 * Cookies de session (S7) : définis une seule fois pour tous les chemins de connexion (A3).
 * Les jetons ne sont jamais renvoyés dans le corps des réponses ni lisibles par le JavaScript.
 */
export const ACCESS_COOKIE_BASE = 'accessToken';
export const REFRESH_COOKIE_BASE = 'refreshToken';

const isProduction = () => process.env.NODE_ENV === 'production';
/**
 * En production, les préfixes du navigateur interdisent à un sous-domaine voisin de déposer ou
 * d'écraser ces cookies (« cookie tossing », S29) : `__Host-` (Secure, Path=/, sans Domain) pour
 * l'accès ; `__Secure-` pour le rafraîchissement, dont le `Path=/auth` exclut `__Host-`.
 */
export const accessCookieName = () =>
  isProduction() ? `__Host-${ACCESS_COOKIE_BASE}` : ACCESS_COOKIE_BASE;
export const refreshCookieName = () =>
  isProduction() ? `__Secure-${REFRESH_COOKIE_BASE}` : REFRESH_COOKIE_BASE;
/** Noms possibles (avec et sans préfixe) : présence d'un cookie de session, quel que soit le mode. */
export const SESSION_COOKIE_NAMES = [
  ACCESS_COOKIE_BASE,
  REFRESH_COOKIE_BASE,
  `__Host-${ACCESS_COOKIE_BASE}`,
  `__Secure-${REFRESH_COOKIE_BASE}`,
];
/** Le jeton de rafraîchissement n'est envoyé qu'aux routes /auth (refresh, logout). */
export const REFRESH_COOKIE_PATH = '/auth';

export interface SessionCookieValues {
  accessToken: string;
  accessMaxAgeSeconds: number;
  refreshToken?: string;
  refreshMaxAgeSeconds?: number;
}

function baseOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
  };
}

export function setSessionCookies(res: Response, values: SessionCookieValues): void {
  res.cookie(accessCookieName(), values.accessToken, {
    ...baseOptions(),
    path: '/',
    maxAge: values.accessMaxAgeSeconds * 1000,
  });
  if (values.refreshToken && values.refreshMaxAgeSeconds) {
    res.cookie(refreshCookieName(), values.refreshToken, {
      ...baseOptions(),
      path: REFRESH_COOKIE_PATH,
      maxAge: values.refreshMaxAgeSeconds * 1000,
    });
  } else {
    // Session sans rafraîchissement (impersonation) : aucun ancien jeton ne doit subsister
    res.clearCookie(refreshCookieName(), { ...baseOptions(), path: REFRESH_COOKIE_PATH });
  }
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(accessCookieName(), { ...baseOptions(), path: '/' });
  res.clearCookie(refreshCookieName(), { ...baseOptions(), path: REFRESH_COOKIE_PATH });
}

/** Lecture sur l'en-tête brut : une valeur en double (cookie déposé par un voisin) est refusée. */
export function readAccessCookie(request: Request): string | undefined {
  return parseCookieHeader(request.headers?.cookie, accessCookieName());
}

export function readRefreshCookie(request: Request): string | undefined {
  return parseCookieHeader(request.headers?.cookie, refreshCookieName());
}

/** Extrait un cookie d'un en-tête `Cookie` brut (handshake WebSocket). */
export function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const values: string[] = [];
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) values.push(part.slice(index + 1).trim());
  }
  // Deux valeurs pour le même nom : un cookie a été déposé par un autre chemin ou sous-domaine
  if (values.length !== 1) return undefined;
  try {
    return decodeURIComponent(values[0]) || undefined;
  } catch {
    return undefined;
  }
}
