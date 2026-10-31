import { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE_NAMES } from './session-cookies';

/** Origines autorisées : `CORS_ORIGINS` (même source que le CORS de `main.ts`). */
export function getAllowedOrigins(): string[] {
  const configured = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : ['http://localhost:3000'];
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Routes exemptées, authentifiées autrement que par cookie (S29) : webhook GitHub (signature
 * HMAC) et SCIM (clé d'API). Elles ne reçoivent jamais de cookie de session d'un navigateur.
 */
const EXEMPT_PATHS: RegExp[] = [/^\/(?:projects\/)?webhooks\/github\/?$/, /^\/scim\/v2(?:\/|$)/];

function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * Anti-CSRF pour les sites voisins (S29) : `SameSite=Strict` ne protège pas d'un autre
 * sous-domaine du même site. Toute requête à effet qui porte un cookie de session doit venir
 * d'une `Origin` (à défaut, d'un `Referer`) autorisée. Les requêtes sans cookie de session
 * (Bearer, webhook, SCIM) ne sont pas concernées : le navigateur ne les authentifie pas seul.
 */
export function originCheckMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!STATE_CHANGING.has(req.method)) return next();
    if (EXEMPT_PATHS.some((pattern) => pattern.test(req.path))) return next();

    const names = (req.headers.cookie ?? '').split(';').map((part) => part.split('=')[0].trim());
    const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => names.includes(name));
    if (!hasSessionCookie) return next();

    const origin = req.headers.origin;
    const candidate =
      typeof origin === 'string' ? origin : originOf(req.headers.referer as string | undefined);
    if (candidate && getAllowedOrigins().includes(candidate)) return next();

    res.status(403).json({
      statusCode: 403,
      message: 'Origine de la requête non autorisée.',
      error: 'Forbidden',
    });
  };
}
