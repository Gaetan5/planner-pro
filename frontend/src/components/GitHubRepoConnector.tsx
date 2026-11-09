import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Github } from 'lucide-react';
import { startGitHubAuthorization } from '../github-oauth';
import { listGitHubRepos, syncGitHubRepo, type GitHubRepo } from '../github-repos';
import { savePendingRepo } from '../pending-repo';
import { SecurityApiError } from '../security-api';

interface Props {
  projectId: string;
  /** Dépôt déjà lié au projet (`owner/repo`), s'il y en a un. */
  currentRepo?: string | null;
  /** Droit `project.manage` : sans lui, ni bouton ni sélecteur (le serveur reste l'autorité). */
  canManage: boolean;
  /** Retour de GitHub : ouvre directement le sélecteur. */
  autoOpen?: boolean;
  onAutoOpened?: () => void;
  onLinked?: (repoFullName: string) => void;
}

/**
 * « Connecter un dépôt » (P9-R). Si GitHub est déjà lié avec la portée `repo`, le sélecteur
 * s'ouvre. Sinon (400 : aucun GitHub lié ; 403 : jeton GitHub invalide) le projet visé est mémorisé 15 minutes puis l'autorisation GitHub
 * `repos` est lancée ; au retour, le sélecteur se rouvre sur le même projet.
 */
export const GitHubRepoConnector: React.FC<Props> = ({
  projectId,
  currentRepo,
  canManage,
  autoOpen = false,
  onAutoOpened,
  onLinked,
}) => {
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [linked, setLinked] = useState<string | null>(currentRepo ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const autoOpened = useRef(false);

  useEffect(() => {
    setLinked(currentRepo ?? null);
    setRepos(null);
  }, [projectId, currentRepo]);

  const open = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      setRepos(await listGitHubRepos());
    } catch (err) {
      if (err instanceof SecurityApiError && [400, 403].includes(err.status)) {
        if (!savePendingRepo(projectId)) {
          setError('Projet invalide : impossible de lancer la connexion GitHub.');
        } else {
          try {
            await startGitHubAuthorization('repos');
          } catch {
            setError('Impossible de démarrer la connexion GitHub.');
          }
        }
      } else {
        setError(err instanceof Error ? err.message : 'Dépôts GitHub indisponibles.');
      }
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!autoOpen || autoOpened.current) return;
    autoOpened.current = true;
    onAutoOpened?.();
    if (canManage) void open();
  }, [autoOpen, canManage, open, onAutoOpened]);

  const choose = async (repo: GitHubRepo) => {
    setError('');
    setBusy(true);
    try {
      const project = await syncGitHubRepo(projectId, repo.fullName);
      const saved = project.githubRepo ?? repo.fullName;
      setLinked(saved);
      setRepos(null);
      onLinked?.(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La liaison du dépôt a échoué.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="integration-form-section" aria-label="Dépôt GitHub du projet">
      <h3>
        <Github size={18} /> Dépôt GitHub
      </h3>
      <p>{linked ? <>Dépôt lié : {linked}</> : 'Aucun dépôt lié à ce projet.'}</p>
      {error && <div role="alert">{error}</div>}
      {canManage && !repos && (
        <button type="button" className="btn-primary-gradient" disabled={busy} onClick={open}>
          Connecter un dépôt
        </button>
      )}
      {canManage && repos && (
        <>
          <p>
            Choisissez le dépôt à lier. L'accès GitHub accordé (portée « repo ») couvre aussi vos
            dépôts privés.
          </p>
          {repos.length === 0 ? (
            <p>Aucun dépôt disponible sur ce compte GitHub.</p>
          ) : (
            <ul>
              {repos.map((repo) => (
                <li key={repo.id}>
                  <strong>{repo.fullName}</strong>
                  {repo.private ? ' (privé)' : ''}
                  <button
                    type="button"
                    className="btn-refresh-glass"
                    disabled={busy}
                    onClick={() => void choose(repo)}
                  >
                    Lier {repo.fullName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-refresh-glass" onClick={() => setRepos(null)}>
            Annuler
          </button>
        </>
      )}
    </section>
  );
};
