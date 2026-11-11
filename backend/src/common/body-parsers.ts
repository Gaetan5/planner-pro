import { NestExpressApplication } from '@nestjs/platform-express';
import { RedisService } from '../redis/redis.service';
import {
  WEBHOOK_FAILURES_PER_MINUTE,
  webhookAddressFailureKey,
  webhookFailureKey,
  webhookLimits,
} from '../projects/github-webhook.util';

/**
 * Limites des corps de requête (S23). La valeur par défaut d'Express (100 ko) est trop basse pour
 * certaines routes légitimes et rien ne la fixait explicitement. Les corps JSON sont plafonnés à
 * 1 Mo partout, sauf les livraisons du webhook GitHub (plafond dédié).
 */
export const JSON_BODY_LIMIT = '1mb';
/**
 * Plafond des livraisons du webhook GitHub, décision d'exploitation du 2026-11-10 : 2 Mo (GitHub
 * peut en envoyer jusqu'à 25 Mo, mais la route est publique et le corps est lu en mémoire avant la
 * vérification de la signature). Au-delà : 413, visible dans « Recent Deliveries » de GitHub. Le
 * corps est lu en brut, sans analyse JSON, puis analysé seulement si la signature est valide.
 */
export const WEBHOOK_BODY_LIMIT = '2mb';
/** Délai maximal de la consultation du compteur de refus (au-delà : la requête passe). */
const PRECHECK_TIMEOUT_MS = 300;

const JSON_TYPES = ['application/json', 'application/scim+json'];
const WEBHOOK_PATH = /^\/projects\/([^/]+)\/webhooks\/github\/?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE_HEADER = /^sha256=[0-9a-f]{64}$/i;

interface MinimalRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Une requête relève du plafond dédié seulement si elle vise la route de réception, en POST, et
 * porte déjà une signature de forme valide et un identifiant de livraison : une requête anonyme
 * quelconque ne peut pas faire lire 10 Mo en mémoire.
 */
export function isWebhookDelivery(req: MinimalRequest): boolean {
  if (req.method !== 'POST') return false;
  const path = (req.url ?? '').split('?')[0];
  if (!WEBHOOK_PATH.test(path)) return false;
  const signature = req.headers['x-hub-signature-256'];
  const delivery = req.headers['x-github-delivery'];
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  return (
    typeof signature === 'string' &&
    SIGNATURE_HEADER.test(signature) &&
    typeof delivery === 'string' &&
    delivery.length > 0 &&
    contentType.startsWith('application/json')
  );
}

/**
 * Pré-contrôle AVANT toute lecture du corps (r44-m1) : si l'adresse a déjà essuyé 20 refus en une
 * minute pour ce projet (ou 100 tous projets confondus, r45-m1), 429 immédiat, connexion fermée, sans lire ni copier le corps. Les
 * compteurs sont ceux de `GitHubWebhookService` (un refus y est compté). Redis lent ou en panne :
 * la requête passe (le service reste fail-closed pour l'anti-rejeu). Le compteur étant propre au
 * couple (adresse, projet), les livraisons des autres projets depuis la même adresse ne sont pas
 * touchées ; un 429 dure au plus 60 s.
 */
export function webhookFailurePrecheck(getRedis: () => Pick<RedisService, 'get'> | undefined) {
  return async (
    req: MinimalRequest & { ip?: string },
    res: {
      status(code: number): { set(name: string, value: string): { json(body: unknown): void } };
    },
    next: () => void,
  ) => {
    if (req.method !== 'POST') return next();
    const match = WEBHOOK_PATH.exec((req.url ?? '').split('?')[0]);
    if (!match || !UUID.test(match[1]) || !req.ip) return next();
    const redis = getRedis();
    if (!redis) return next();
    let timer: NodeJS.Timeout | undefined;
    let failures: number;
    let addressFailures: number;
    try {
      const [byProject, byAddress] = await Promise.race([
        Promise.all([
          redis.get(webhookFailureKey(req.ip, match[1])),
          redis.get(webhookAddressFailureKey(req.ip)),
        ]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Délai Redis dépassé')), PRECHECK_TIMEOUT_MS);
        }),
      ]);
      failures = Number(byProject ?? '0');
      addressFailures = Number(byAddress ?? '0');
    } catch {
      return next();
    } finally {
      clearTimeout(timer);
    }
    if (
      failures >= WEBHOOK_FAILURES_PER_MINUTE ||
      addressFailures >= webhookLimits.failuresPerAddressPerMinute
    ) {
      res.status(429).set('Connection', 'close').json({
        statusCode: 429,
        message: 'Trop de requêtes refusées.',
      });
      return;
    }
    next();
  };
}

/**
 * Enregistre le pré-contrôle puis les analyseurs (l'ordre compte : `body-parser` ignore une requête
 * déjà lue). 1. pré-contrôle des refus ; 2. livraisons du webhook GitHub : corps brut, plafond
 * dédié, aucune analyse JSON (la signature est vérifiée d'abord par le service) ; 3. tout le
 * reste : JSON, 1 Mo. Le corps brut est conservé (`rawBody: true` à la création, HMAC, S21).
 */
export function registerBodyParsers(app: NestExpressApplication): void {
  app.use(
    webhookFailurePrecheck(() => {
      try {
        return app.get(RedisService, { strict: false });
      } catch {
        return undefined;
      }
    }),
  );
  app.useBodyParser('raw', {
    limit: WEBHOOK_BODY_LIMIT,
    type: (req: MinimalRequest) => isWebhookDelivery(req),
  });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT, type: JSON_TYPES });
}
