import { useEffect, useState } from 'react';
import { listSessions } from './security-api';

/**
 * Indique si la session courante est une session d'impersonation (S18), d'après le serveur
 * (`impersonated` sur l'élément `current` de `GET /auth/sessions`) : l'information ne dépend plus
 * du stockage du navigateur, donc vaut aussi dans un nouvel onglet.
 *
 * `null` tant que la réponse n'est pas arrivée (l'appelant masque alors les actions sensibles) ;
 * `false` si la lecture échoue, le serveur restant l'autorité (403 en impersonation).
 */
export function useImpersonatedSession(): boolean | null {
  const [impersonated, setImpersonated] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((sessions) => {
        if (!cancelled) setImpersonated(sessions.find((s) => s.current)?.impersonated === true);
      })
      .catch(() => {
        if (!cancelled) setImpersonated(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return impersonated;
}
