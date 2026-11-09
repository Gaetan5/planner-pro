import React, { useEffect, useState } from 'react';
import { Github } from 'lucide-react';
import { startGitHubAuthorization, linkGitHub, type GitHubPurpose } from '../github-oauth';
import { getIdentities, type Identities } from '../security-api';
import {
  IdentityProofFields,
  buildProof,
  describeIdentityError,
  emptyProof,
  type ProofState,
} from './IdentityProofFields';
import './SecurityPage.css';

interface Props {
  purpose: Exclude<GitHubPurpose, 'login'>;
  code: string;
  state: string;
  accountEmail: string;
  onDone: (notice: string) => void;
  onCancel: () => void;
}

/**
 * Retour de GitHub avec la finalité `link` ou `repos` (S31, P9) : la liaison n'est pas lancée
 * automatiquement. L'utilisateur confirme son identité (mot de passe ou connexion récente, plus le
 * code MFA si actif) avant l'appel à `/auth/github/link`. Le serveur consomme le cookie de `state`
 * dès le premier essai : après un échec, il faut repartir de GitHub.
 */
export const GitHubLinkConfirm: React.FC<Props> = ({
  purpose,
  code,
  state,
  accountEmail,
  onDone,
  onCancel,
}) => {
  const [identities, setIdentities] = useState<Identities | null>(null);
  const [proof, setProof] = useState<ProofState>(emptyProof);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getIdentities()
      .then(setIdentities)
      .catch((err: unknown) => setError(describeIdentityError(err, true)));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identities) return;
    setBusy(true);
    setError('');
    try {
      const result = await linkGitHub(code, state, buildProof(proof, identities));
      setProof(emptyProof);
      onDone(
        purpose === 'repos'
          ? `Dépôts GitHub connectés (compte ${result.githubUsername}).`
          : `Compte GitHub ${result.githubUsername} associé. Un e-mail de confirmation vous a été envoyé.`,
      );
    } catch (err) {
      setFailed(true);
      setProof(emptyProof);
      setError(describeIdentityError(err, identities.hasPassword));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="security-page">
      <h2 className="security-title">
        <Github size={22} /> Lier votre compte GitHub
      </h2>
      <section className="security-card" aria-label="Confirmation de la liaison GitHub">
        <p>
          Le compte GitHub que vous venez d'autoriser sera lié au compte Planner-Pro{' '}
          <strong>{accountEmail}</strong>
          {purpose === 'repos'
            ? ", avec l'accès à vos dépôts, y compris privés (portée « repo »)"
            : ''}
          . Son nom d'utilisateur s'affichera dans « Sécurité du compte » une fois la liaison faite,
          et il pourra alors se connecter à ce compte.
        </p>
        <p className="security-hint">
          Si vous n'êtes pas à l'origine de cette demande, annulez : rien n'a été lié.
        </p>
        {error && (
          <div className="security-error" role="alert">
            {error}
          </div>
        )}
        {failed ? (
          <>
            <p>L'autorisation GitHub ne peut plus être réutilisée : recommencez depuis GitHub.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void startGitHubAuthorization(purpose)}
            >
              Recommencer avec GitHub
            </button>
          </>
        ) : (
          identities && (
            <form onSubmit={submit}>
              <IdentityProofFields
                hasPassword={identities.hasPassword}
                mfaEnabled={identities.mfaEnabled}
                value={proof}
                onChange={setProof}
              />
              <button type="submit" className="btn-primary" disabled={busy}>
                Confirmer la liaison GitHub
              </button>
            </form>
          )
        )}
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Annuler
        </button>
      </section>
    </div>
  );
};
