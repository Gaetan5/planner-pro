import { NestExpressApplication } from '@nestjs/platform-express';

/** Nombre maximal de proxys de confiance acceptés (au-delà, une valeur suspecte : refus). */
export const MAX_TRUST_PROXY_HOPS = 5;

/**
 * Nombre de reverse proxys placés devant le backend (`TRUST_PROXY_HOPS`, S24). Express n'accorde
 * foi à `X-Forwarded-For` qu'au-delà de ce nombre de sauts : sans réglage, `req.ip` est l'adresse
 * du proxy et tous les clients partagent le même compteur de limitation ; avec une valeur trop
 * grande, un client peut falsifier son adresse.
 * - variable absente : 0 en développement/test (aucun proxy), erreur en production ;
 * - sinon un entier de 0 à 5.
 */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (raw === undefined || raw === '') {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        "La variable d'environnement TRUST_PROXY_HOPS doit être définie en production (nombre de reverse proxys devant le backend, 0 s'il n'y en a aucun).",
      );
    }
    return 0;
  }
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_TRUST_PROXY_HOPS) {
    throw new Error(
      `TRUST_PROXY_HOPS invalide (« ${raw} ») : un entier de 0 à ${MAX_TRUST_PROXY_HOPS} est attendu.`,
    );
  }
  return Number(raw);
}

export function configureTrustProxy(
  app: NestExpressApplication,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const hops = resolveTrustProxyHops(env);
  // 0 : `false` (X-Forwarded-For ignoré, `req.ip` = adresse de la connexion)
  app.set('trust proxy', hops === 0 ? false : hops);
  return hops;
}
