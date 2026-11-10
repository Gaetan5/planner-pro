import { NextFunction, Request, Response } from 'express';

/**
 * Routes dont les réponses ne doivent jamais être conservées par un navigateur ou un proxy (O16) :
 * `/auth/*` (secret TOTP, codes de secours, sessions, état du compte), `/admin/*` (console de
 * plateforme) et la régénération du secret de webhook GitHub, qui renvoie le secret en clair.
 * Insensible à la casse, comme le routage d'Express.
 */
const NO_STORE_PATHS: RegExp[] = [
  /^\/auth(?:\/|$)/i,
  /^\/admin(?:\/|$)/i,
  /^\/projects\/[^/]+\/webhooks\/github\/secret\/?$/i,
];

/**
 * Pose `Cache-Control: no-store` et `Pragma: no-cache` dès l'entrée de la requête, donc aussi sur
 * les réponses d'erreur (401, 403, 429) et sur les redirections de ces routes.
 */
export function noStoreMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (NO_STORE_PATHS.some((pattern) => pattern.test(req.path))) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  };
}
