import { apiErrorMessage } from './http-errors';
import { SecurityApiError, type IdentityProof } from './security-api';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export type GitHubPurpose = 'login' | 'link' | 'repos';

/**
 * Démarre l'OAuth GitHub (S9) : le serveur génère le `state` aléatoire (cookie signé httpOnly) et
 * renvoie l'URL d'autorisation, avec la portée minimale (`read:user user:email`). `repo` n'est
 * demandé que pour l'action « connecter un dépôt » (`purpose: 'repos'`).
 */
export async function startGitHubAuthorization(purpose: GitHubPurpose = 'login'): Promise<void> {
  const res = await fetch(
    `${BACKEND_URL}/auth/github/authorize?purpose=${encodeURIComponent(purpose)}`,
    { credentials: 'include' },
  );
  if (!res.ok) {
    throw new Error('Impossible de démarrer la connexion GitHub.');
  }
  const { url } = (await res.json()) as { url: string };
  window.location.href = url;
}

/**
 * Finalité de l'autorisation GitHub en cours (S9-b), lue dans le cookie signé côté serveur : au
 * retour de GitHub, c'est elle qui décide de la route à appeler (connexion ou liaison).
 */
export async function fetchGitHubPurpose(): Promise<GitHubPurpose> {
  const res = await fetch(`${BACKEND_URL}/auth/github/pending`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error('Autorisation GitHub expirée. Recommencez.');
  }
  const { purpose } = (await res.json()) as { purpose: GitHubPurpose };
  return purpose;
}

/**
 * Liaison d'un compte GitHub au compte connecté (finalités `link` et `repos`). S31 : le mot de
 * passe (ou la connexion récente) et le code MFA sont saisis au retour de GitHub et envoyés avec
 * `code` et `state` ; ils ne sont jamais conservés.
 */
export async function linkGitHub(
  code: string,
  state: string,
  proof: IdentityProof = {},
): Promise<{ githubUsername: string }> {
  const res = await fetch(`${BACKEND_URL}/auth/github/link`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      state,
      ...Object.fromEntries(Object.entries(proof).filter(([, value]) => value)),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    githubUsername?: string;
  };
  if (!res.ok) {
    throw new SecurityApiError(
      apiErrorMessage(res.status, data.message, 'La liaison du compte GitHub a échoué.'),
      res.status,
    );
  }
  return { githubUsername: data.githubUsername ?? '' };
}
