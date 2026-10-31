/**
 * Session navigateur (S7) : le jeton d'accès et le jeton de rafraîchissement sont des cookies
 * httpOnly, jamais lisibles par le JavaScript. Ce module installe un `fetch` unique qui :
 *  - envoie les cookies sur tous les appels vers l'API (`credentials: 'include'`) ;
 *  - sur un 401, tente UNE rotation de session (mono-vol) puis rejoue la requête ;
 *  - signale la fin de session à l'application (événement `planner:session-expired`).
 * Les requêtes à corps en flux ne sont pas rejouées : l'application n'envoie que des corps
 * textuels ou FormData.
 */
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const SESSION_EXPIRED_EVENT = 'planner:session-expired';

/** Routes qui ne doivent jamais déclencher une rotation : connexion, inscription, jetons. */
const NO_REFRESH_PREFIXES = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/mfa/challenge',
  '/auth/firebase/login',
  '/auth/github/login',
  '/auth/github/authorize',
  '/auth/sso/',
  '/auth/mock/login',
  '/auth/password/',
  '/auth/email/',
];

let refreshInFlight: Promise<boolean> | null = null;
let installed = false;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Renouvelle la session via le cookie de rafraîchissement. Une seule requête à la fois, même si
 * plusieurs appels reçoivent un 401 simultanément. Renvoie false si la session est perdue.
 */
export function refreshSession(
  nativeFetch: typeof fetch = window.fetch.bind(window),
): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await nativeFetch(`${BACKEND_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) return true;
        if (res.status === 409) {
          // Un autre onglet vient de renouveler la session : les cookies sont déjà à jour
          await new Promise((resolve) => setTimeout(resolve, 300));
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** Installe le `fetch` de session (idempotent). À appeler une fois au démarrage. */
export function installSessionFetch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (!url.startsWith(BACKEND_URL)) {
      return nativeFetch(input, init);
    }

    const options: RequestInit = { ...init, credentials: 'include' };
    const response = await nativeFetch(input, options);
    if (response.status !== 401) return response;

    const path = pathOf(url);
    if (NO_REFRESH_PREFIXES.some((prefix) => path.startsWith(prefix))) return response;

    if (!(await refreshSession(nativeFetch))) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      return response;
    }
    return nativeFetch(input, options);
  };
}
