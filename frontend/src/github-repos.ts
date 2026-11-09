import { SecurityApiError } from './security-api';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
}

async function call<T>(path: string, method: 'GET' | 'POST', body?: Record<string, string>) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const message = (data as { message?: string | string[] }).message;
    throw new SecurityApiError(
      (Array.isArray(message) ? message.join(' ') : message) ||
        'La demande a échoué. Réessayez plus tard.',
      res.status,
    );
  }
  return data as T;
}

/** Dépôts GitHub de l'utilisateur. 400 : aucun GitHub lié ; 403 : jeton GitHub invalide ou révoqué. */
export const listGitHubRepos = () => call<GitHubRepo[]>('/auth/github/repos', 'GET');

/** Lie un dépôt à un projet. Le dépôt voyage dans le corps, jamais dans le chemin. */
export const syncGitHubRepo = (projectId: string, repoFullName: string) =>
  call<{ id: string; githubRepo: string | null }>('/auth/github/sync', 'POST', {
    projectId,
    repoFullName,
  });
