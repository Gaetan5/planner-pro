import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const SIGNATURE = /^sha256=([0-9a-fA-F]{64})$/;
const CLOSING_KEYWORDS =
  /(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\s+#([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/gi;

/** Secret de webhook : 32 octets aléatoires, en hexadécimal (64 caractères). */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Vérifie `X-Hub-Signature-256` : HMAC-SHA256 du corps brut exact reçu (pas d'un JSON
 * re-sérialisé), comparé en temps constant après contrôle du format et de la longueur.
 */
export function verifyGitHubSignature(
  secret: string,
  rawBody: Buffer | undefined,
  signature: string | undefined,
): boolean {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof signature !== 'string') return false;
  const match = SIGNATURE.exec(signature);
  if (!match) return false;
  const received = Buffer.from(match[1], 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Identifiants de tâches désignés par « fixes #<uuid> » (et variantes) dans un texte. */
export function extractTaskIdsFromText(text: string): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(CLOSING_KEYWORDS), (m) => m[1]);
}

/**
 * Refus d'authentification tolérés par adresse, par projet et par minute avant de répondre 429
 * aux requêtes refusées (S24, r44-m1). Partagé par le pré-contrôle (avant lecture du corps) et par
 * le service. La clé porte l'identifiant du projet : un client mal configuré, ou un tiers qui
 * connaît un `projectId`, n'affecte pas les livraisons des autres projets depuis la même adresse
 * (adresses de GitHub partagées entre tous ses clients).
 */
export const WEBHOOK_FAILURES_PER_MINUTE = 20;
export const WEBHOOK_FAILURE_WINDOW_SECONDS = 60;
export const webhookFailureKey = (ip: string, projectId: string): string =>
  `github-webhook-failures:${ip}:${projectId}`;
