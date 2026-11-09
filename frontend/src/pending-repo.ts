/**
 * Dépôt en attente (P9-R). « Connecter un dépôt » peut exiger un détour par GitHub (portée `repo`) :
 * le projet visé est conservé 15 minutes en `sessionStorage` (jamais en `localStorage`, jamais dans
 * le `state` OAuth) pour rouvrir le sélecteur au retour. L'identifiant lu est validé par format
 * avant tout usage : une entrée altérée est ignorée et supprimée.
 */
export const PENDING_REPO_KEY = 'planner_pending_repo';
export const PENDING_REPO_TTL_MS = 15 * 60 * 1000;

interface PendingRepo {
  projectId: string;
  expiresAt: number;
}

/** Format émis par le serveur pour les projets (UUID). */
export const isProjectId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function clearPendingRepo(): void {
  sessionStorage.removeItem(PENDING_REPO_KEY);
}

/** Enregistre le projet visé. Un identifiant au format invalide n'est pas stocké. */
export function savePendingRepo(projectId: string, now = Date.now()): boolean {
  if (!isProjectId(projectId)) return false;
  const value: PendingRepo = { projectId, expiresAt: now + PENDING_REPO_TTL_MS };
  sessionStorage.setItem(PENDING_REPO_KEY, JSON.stringify(value));
  return true;
}

/** Projet en attente, ou null s'il est absent, illisible, invalide ou expiré (entrée supprimée). */
export function readPendingRepo(now = Date.now()): string | null {
  const raw = sessionStorage.getItem(PENDING_REPO_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingRepo>;
    if (isProjectId(value.projectId) && Number(value.expiresAt) > now) {
      return value.projectId;
    }
  } catch {
    // entrée illisible : supprimée ci-dessous
  }
  clearPendingRepo();
  return null;
}
