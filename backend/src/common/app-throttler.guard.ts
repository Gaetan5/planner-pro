import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';

/** Requêtes par minute et par clé d'API SCIM authentifiée (S11-a, S11-b). */
export const SCIM_KEY_LIMIT = 300;
/** Requêtes par minute et par adresse IP sur une route SCIM : large, car des IdP partagent leurs IP sortantes (S11-b). */
export const SCIM_IP_LIMIT = 3000;
export const SCIM_WINDOW_MS = 60000;
/** Message du 429 (r47-m2) : affiché tel quel par les clients, donc en français ; `Retry-After` indique le délai. */
export const THROTTLE_MESSAGE = 'Trop de requêtes. Réessayez dans quelques instants.';

/**
 * Identifiant de suivi du garde global (S11-b) : toujours l'adresse IP cliente.
 * Le garde global s'exécute avant toute authentification : aucune donnée fournie par le client
 * (URL, query string, en-tête Authorization) ne doit permettre de changer de compteur.
 * La limite par clé SCIM est appliquée après authentification par `ScimKeyThrottlerGuard`.
 */
export function resolveThrottlerTracker(
  req: { ips?: string[]; ip?: string } & Record<string, unknown>,
): string {
  return req.ips?.length ? req.ips[0] : req.ip || '127.0.0.1';
}

/** Garde de limitation de débit global : suivi par adresse IP sur toutes les routes. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return resolveThrottlerTracker(req);
  }

  /** Message du 429 en français (r47-m2) ; l'en-tête `Retry-After` est posé par `ThrottlerGuard`. */
  protected async getErrorMessage(): Promise<string> {
    return THROTTLE_MESSAGE;
  }
}

/**
 * Limite par clé d'API SCIM, à placer APRÈS `ScimAuthGuard` : le compteur porte sur
 * `scimApiKeyId` (identifiant en base), jamais sur une valeur fournie par le client (S11-b).
 * Le compteur est commun à toutes les routes SCIM de la clé.
 */
@Injectable()
export class ScimKeyThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<{ scimApiKeyId?: string }>();
    const res = http.getResponse<{ header: (name: string, value: unknown) => void }>();
    if (!req.scimApiKeyId) {
      // Sans authentification préalable, aucun compteur par clé : la requête est refusée.
      throw new ThrottlerException(THROTTLE_MESSAGE);
    }
    const key = createHash('sha256').update(`scim-key:${req.scimApiKeyId}`).digest('hex');
    const { totalHits, timeToExpire } = await this.storageService.increment(key, SCIM_WINDOW_MS);
    if (totalHits > SCIM_KEY_LIMIT) {
      res.header('Retry-After', timeToExpire);
      throw new ThrottlerException(THROTTLE_MESSAGE);
    }
    return true;
  }
}
