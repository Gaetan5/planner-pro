/**
 * Appels de l'écran « Sécurité du compte » (P9, volet MFA). L'authentification passe par les
 * cookies de session (fetch de session installé au démarrage). Aucun secret n'est conservé ici.
 */
import { apiErrorMessage } from './http-errors';
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface MfaStatus {
  mfaEnabled: boolean;
  /** Faux pour un compte Firebase ou GitHub : réauthentification par connexion récente (< 5 min). */
  hasPassword: boolean;
}

export interface MfaSetup {
  secret: string;
  authUri: string;
}

/** Erreur d'API : conserve le statut HTTP pour adapter le message (403, 400, 409…). */
export class SecurityApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SecurityApiError';
  }
}

async function call<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: Record<string, string>,
) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (!res.ok) {
    throw new SecurityApiError(
      apiErrorMessage(res.status, data.message, 'La demande a échoué. Réessayez plus tard.'),
      res.status,
    );
  }
  return data as T;
}

/** Champs optionnels omis du corps quand ils sont vides (le backend valide chaque format). */
const clean = (fields: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value)) as Record<string, string>;

export const getMfaStatus = () => call<MfaStatus>('/auth/mfa/status', 'GET');

export const setupMfa = (password?: string) =>
  call<MfaSetup>('/auth/mfa/setup', 'POST', clean({ password }));

export const confirmMfa = (code: string) =>
  call<{ mfaEnabled: true; recoveryCodes: string[] }>('/auth/mfa/confirm', 'POST', { code });

export const disableMfa = (factor: { code?: string; recoveryCode?: string }, password?: string) =>
  call<{ mfaEnabled: false }>('/auth/mfa/disable', 'POST', clean({ ...factor, password }));

export const regenerateRecoveryCodes = (code: string, password?: string) =>
  call<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', 'POST', clean({ code, password }));

/** Preuve de réauthentification exigée pour lier ou délier une identité (S31). */
export interface IdentityProof {
  password?: string;
  mfaCode?: string;
  recoveryCode?: string;
}

export interface Identities {
  firebase: { linked: boolean; email: string | null };
  github: { linked: boolean; username: string | null };
  hasPassword: boolean;
  mfaEnabled: boolean;
  /** Calculé par le serveur : identité liée et autre méthode de connexion disponible. */
  canUnlink: Record<IdentityProvider, boolean>;
}

export type IdentityProvider = 'firebase' | 'github';

export const getIdentities = () => call<Identities>('/auth/identities', 'GET');

/** Le jeton Firebase ne vit qu'en mémoire, le temps de la confirmation : jamais persisté. */
export const linkFirebase = (idToken: string, proof: IdentityProof) =>
  call<{ firebaseEmail: string }>('/auth/firebase/link', 'POST', clean({ idToken, ...proof }));

export const unlinkIdentity = (provider: IdentityProvider, proof: IdentityProof) =>
  call<Record<string, never>>(`/auth/${provider}/unlink`, 'POST', clean({ ...proof }));

/** Session active du compte (`GET /auth/sessions`). Aucun jeton n'est exposé par le serveur. */
export interface ActiveSession {
  id: string;
  createdAt: string;
  authenticatedAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
  /** Session ouverte par un administrateur (impersonation, S18). */
  impersonated: boolean;
}

export const listSessions = () => call<ActiveSession[]>('/auth/sessions', 'GET');

/** Le `sid` est encodé : c'est un segment de chemin. Réponse 204, 404 si la session n'est plus là. */
export const revokeSession = (sid: string) =>
  call<Record<string, never>>(`/auth/sessions/${encodeURIComponent(sid)}`, 'DELETE');

/** Route sans corps (S32) : ferme toutes les sessions sauf la courante. */
export const revokeOtherSessions = () =>
  call<{ revoked: number }>('/auth/sessions/revoke-others', 'POST');
