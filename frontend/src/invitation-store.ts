/**
 * Invitation en attente (P13-a). Le jeton d'invitation est un secret porteur : il est retiré de
 * l'URL dès la lecture, puis conservé au plus 30 minutes en `sessionStorage` (jamais en
 * `localStorage`, jamais dans le `state` OAuth) pour survivre aux redirections GitHub, SSO ou
 * Firebase et au défi MFA.
 */
import { apiErrorMessage } from './http-errors';
export const PENDING_INVITE_KEY = 'planner_pending_invite';
export const PENDING_INVITE_TTL_MS = 30 * 60 * 1000;

interface PendingInvite {
  token: string;
  expiresAt: number;
}

/**
 * Format émis par le serveur (`randomBytes(32).toString('hex')`). Tout autre contenu est refusé
 * avant d'être stocké ou inséré dans une URL d'API (S32 : traversée de chemin côté client).
 */
export const isInviteToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function savePendingInvite(token: string, now = Date.now()): void {
  const value: PendingInvite = { token, expiresAt: now + PENDING_INVITE_TTL_MS };
  sessionStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(value));
}

export function clearPendingInvite(): void {
  sessionStorage.removeItem(PENDING_INVITE_KEY);
}

/** Jeton en attente, ou null s'il est absent, illisible ou expiré (l'entrée est alors supprimée). */
export function readPendingInvite(now = Date.now()): string | null {
  const raw = sessionStorage.getItem(PENDING_INVITE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingInvite>;
    if (isInviteToken(value.token) && Number(value.expiresAt) > now) {
      return value.token;
    }
  } catch {
    // entrée illisible : supprimée ci-dessous
  }
  clearPendingInvite();
  return null;
}

/**
 * Lit `?token=` ou `?invite=`, retire immédiatement le paramètre de l'URL et enregistre le jeton
 * en attente. Renvoie le jeton lu, ou null si l'URL n'en contient pas.
 */
export function captureInviteFromUrl(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token') || url.searchParams.get('invite');
  if (!token) return null;
  // Le paramètre est toujours retiré de l'URL ; un jeton au format invalide n'est ni stocké ni utilisé
  url.searchParams.delete('token');
  url.searchParams.delete('invite');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  if (!isInviteToken(token)) return null;
  savePendingInvite(token);
  return token;
}

/** Erreur d'API d'invitation : conserve le statut HTTP (403 : adresse différente). */
export class InvitationApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'InvitationApiError';
  }
}

/** Message d'un corps d'erreur Nest (`{ message }` ou texte brut). */
export async function invitationErrorFrom(res: Response, fallback: string) {
  const text = await res.text().catch(() => '');
  let message = text;
  try {
    const data = JSON.parse(text) as { message?: string | string[] };
    message = Array.isArray(data.message) ? data.message.join(' ') : (data.message ?? '');
  } catch {
    // texte brut ; sauf pour un 429, où il vient de Nginx (HTML) : on laisse le repli générique
    if (res.status === 429) message = '';
  }
  return new InvitationApiError(apiErrorMessage(res.status, message, fallback), res.status);
}
