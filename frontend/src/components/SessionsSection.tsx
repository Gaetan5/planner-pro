import React, { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import {
  SecurityApiError,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  type ActiveSession,
} from '../security-api';
import './SecurityPage.css';

/** Navigateur et système lisibles tirés du `User-Agent` ; repli sur la chaîne tronquée (120). */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Appareil inconnu';
  const browser =
    /Edg\//.test(userAgent) || /EdgA\//.test(userAgent)
      ? 'Edge'
      : /OPR\/|Opera/.test(userAgent)
        ? 'Opera'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(userAgent)
            ? 'Chrome'
            : /Safari\//.test(userAgent)
              ? 'Safari'
              : null;
  const system = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(userAgent)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (browser && system) return `${browser} sur ${system}`;
  if (browser || system) return (browser ?? system) as string;
  return userAgent.length > 120 ? `${userAgent.slice(0, 120)}…` : userAgent;
}

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('fr-FR');
};

/**
 * Sessions actives du compte (P9-S). Révoquer une session ou fermer toutes les autres n'exige pas
 * de réauthentification : c'est une action de protection. Les actions sont masquées en
 * impersonation (le serveur les refuse aussi, 403).
 */
export const SessionsSection: React.FC<{
  /** Change quand une autre partie de l'écran a fermé des sessions : relecture de la liste. */
  refreshKey?: number;
}> = ({ refreshKey = 0 }) => {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessions());
    } catch (err) {
      setError(err instanceof SecurityApiError ? err.message : 'Sessions indisponibles.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const run = async (action: () => Promise<void>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof SecurityApiError ? err.message : 'La demande a échoué. Réessayez plus tard.',
      );
      // Un 404 (session déjà fermée) ou toute autre erreur : la liste est relue
      await refresh();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const revokeOne = (sid: string) =>
    run(async () => {
      await revokeSession(sid);
      setNotice('Session fermée.');
      await refresh();
    });

  const revokeOthers = () =>
    run(async () => {
      const { revoked } = await revokeOtherSessions();
      setNotice(revoked === 1 ? '1 session fermée.' : `${revoked} sessions fermées.`);
      await refresh();
    });

  if (!sessions) {
    return error ? (
      <div className="security-page">
        <div className="security-error" role="alert">
          {error}
        </div>
      </div>
    ) : null;
  }

  const hasOthers = sessions.some((s) => !s.current);
  // Information fournie par le serveur (S18) : valable aussi dans un onglet ouvert pendant l'impersonation
  const readOnly = sessions.some((s) => s.current && s.impersonated);

  return (
    <div className="security-page">
      {error && (
        <div className="security-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="security-notice" role="status">
          {notice}
        </div>
      )}
      <section className="security-card" aria-label="Sessions actives">
        <h3>
          <MonitorSmartphone size={18} /> Sessions actives
        </h3>
        <ul className="security-identities">
          {sessions.map((s) => (
            <li className="security-identity" key={s.id}>
              <strong>{describeUserAgent(s.userAgent)}</strong>
              {s.current && <span className="security-badge">Cette session</span>}
              {s.impersonated && (
                <span className="security-badge">Session d'assistance d'un administrateur</span>
              )}
              <small>
                Ouverte le {formatDate(s.createdAt)} · dernière authentification le{' '}
                {formatDate(s.authenticatedAt)} · expire le {formatDate(s.expiresAt)}
              </small>
              {!s.current &&
                !readOnly &&
                (confirming === s.id ? (
                  <>
                    <span>Fermer cette session ?</span>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy}
                      onClick={() => void revokeOne(s.id)}
                    >
                      Confirmer
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setConfirming(null)}>
                      Annuler
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => setConfirming(s.id)}
                  >
                    Révoquer
                  </button>
                ))}
            </li>
          ))}
        </ul>
        {hasOthers && !readOnly && (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => void revokeOthers()}
          >
            Fermer les autres sessions
          </button>
        )}
        {readOnly && (
          <small className="security-hint">
            Session d'impersonation : la gestion des sessions est désactivée.
          </small>
        )}
      </section>
    </div>
  );
};
