const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/** Le `state` SSO commence par ce préfixe (non secret) : il distingue le retour SSO du retour GitHub. */
export const SSO_STATE_PREFIX = 'sso_';

export const isSsoState = (state: string | null): state is string =>
  Boolean(state) && (state as string).startsWith(SSO_STATE_PREFIX);

/**
 * Démarre le flux SSO (S10) : le serveur génère `state`, `nonce` et PKCE, lie le `state` à ce
 * navigateur (cookie httpOnly) et renvoie l'URL de l'IdP. Ni domaine ni URL de retour au retour.
 */
export async function startSsoAuthorization(domain: string): Promise<void> {
  const res = await fetch(
    `${BACKEND_URL}/auth/sso/authorize?domain=${encodeURIComponent(domain)}`,
    { credentials: 'include' },
  );
  if (!res.ok) {
    throw new Error('Impossible de démarrer la connexion SSO.');
  }
  const { url } = (await res.json()) as { url: string };
  window.location.href = url;
}
