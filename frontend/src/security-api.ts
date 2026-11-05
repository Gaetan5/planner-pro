/**
 * Appels de l'écran « Sécurité du compte » (P9, volet MFA). L'authentification passe par les
 * cookies de session (fetch de session installé au démarrage). Aucun secret n'est conservé ici.
 */
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

async function call<T>(path: string, method: 'GET' | 'POST', body?: Record<string, string>) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
    throw new SecurityApiError(message || 'La demande a échoué. Réessayez plus tard.', res.status);
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
