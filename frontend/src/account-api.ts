/**
 * Parcours de compte par e-mail (P6) : vérification d'adresse et réinitialisation du mot de passe.
 * Les jetons voyagent dans le corps d'un POST, jamais dans l'URL d'un appel d'API.
 */
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function post(path: string, body: Record<string, string>): Promise<string> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
    throw new Error(message || 'La demande a échoué. Réessayez plus tard.');
  }
  return (Array.isArray(data.message) ? data.message[0] : data.message) ?? '';
}

export const verifyEmail = (token: string) => post('/auth/email/verify', { token });
export const resendVerification = (email: string) => post('/auth/email/resend', { email });
export const requestPasswordReset = (email: string) => post('/auth/password/forgot', { email });
export const resetPassword = (token: string, password: string) =>
  post('/auth/password/reset', { token, password });

/** Paramètres de lien reçus par e-mail ; l'URL est nettoyée pour ne pas conserver le jeton. */
export type AccountLink = { kind: 'verify' | 'reset'; token: string };

export function readAccountLink(): AccountLink | null {
  const url = new URL(window.location.href);
  const verify = url.searchParams.get('verify');
  const reset = url.searchParams.get('reset');
  const link: AccountLink | null = verify
    ? { kind: 'verify', token: verify }
    : reset
      ? { kind: 'reset', token: reset }
      : null;
  if (link) {
    url.searchParams.delete('verify');
    url.searchParams.delete('reset');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
  return link;
}
