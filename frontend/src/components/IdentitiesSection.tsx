import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Unlink, AlertTriangle } from 'lucide-react';
import { isFirebaseAuthConfigured } from '../firebase-config';
import { startGitHubAuthorization } from '../github-oauth';
import {
  getIdentities,
  linkFirebase,
  unlinkIdentity,
  type Identities,
  type IdentityProvider,
} from '../security-api';
import {
  IdentityProofFields,
  buildProof,
  describeIdentityError,
  emptyProof,
  type ProofState,
} from './IdentityProofFields';
import './SecurityPage.css';

const LABEL: Record<IdentityProvider, string> = { firebase: 'Firebase', github: 'GitHub' };

/** Jeton Firebase obtenu par la connexion, gardé en mémoire le temps de la confirmation. */
interface PendingFirebase {
  idToken: string;
  email: string;
}

/**
 * Identités liées au compte (P9, volet liaison ; S31). Lier ou délier exige une réauthentification
 * récente. L'adresse Firebase est affichée avant confirmation et signalée quand elle diffère de
 * celle du compte. Aucune identité n'est jamais liée automatiquement.
 */
export const IdentitiesSection: React.FC<{
  accountEmail: string;
  /** Message du parcours précédent (retour GitHub) : affiché une seule fois, puis consommé. */
  notice?: string;
  onNoticeShown?: () => void;
}> = ({ accountEmail, notice: initialNotice = '', onNoticeShown }) => {
  const [identities, setIdentities] = useState<Identities | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(initialNotice);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<ProofState>(emptyProof);
  const [unlinking, setUnlinking] = useState<IdentityProvider | null>(null);
  const [fbStep, setFbStep] = useState<'idle' | 'signin' | 'confirm'>('idle');
  const [fbEmail, setFbEmail] = useState('');
  const [fbPassword, setFbPassword] = useState('');
  const [pendingFirebase, setPendingFirebase] = useState<PendingFirebase | null>(null);

  /** Relecture simple ; les erreurs sont gérées par l'appelant. */
  const reloadIdentities = useCallback(async () => setIdentities(await getIdentities()), []);

  const refresh = useCallback(async () => {
    try {
      await reloadIdentities();
    } catch (err) {
      setError(describeIdentityError(err, true));
    }
  }, [reloadIdentities]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // La notice du parcours précédent n'est montrée qu'une fois (P9-L-c)
  useEffect(() => {
    if (initialNotice) onNoticeShown?.();
  }, []);

  const hasPassword = identities?.hasPassword ?? true;
  const flags = { hasPassword, mfaEnabled: identities?.mfaEnabled ?? false };

  const run = async (action: () => Promise<void>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(describeIdentityError(err, hasPassword));
    } finally {
      setBusy(false);
    }
  };

  const resetFirebase = () => {
    setFbStep('idle');
    setFbEmail('');
    setFbPassword('');
    setPendingFirebase(null);
    setProof(emptyProof);
  };

  /** Connexion à Firebase pour obtenir le jeton ; la session Firebase du navigateur est refermée. */
  const signInFirebase = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const [{ reload, signInWithEmailAndPassword }, { getFirebaseAuth, signOutFirebase }] =
        await Promise.all([import('firebase/auth'), import('../firebase-auth')]);
      const credential = await signInWithEmailAndPassword(getFirebaseAuth(), fbEmail, fbPassword);
      await reload(credential.user);
      if (!credential.user.emailVerified) {
        await signOutFirebase();
        throw new Error('Adresse Firebase non vérifiée : validez-la d’abord par e-mail.');
      }
      const idToken = await credential.user.getIdToken();
      await signOutFirebase();
      // État MFA relu avant d'afficher les champs de preuve : il a pu changer depuis le montage (P9-L-b)
      await reloadIdentities();
      setPendingFirebase({ idToken, email: credential.user.email ?? fbEmail });
      setFbPassword('');
      setProof(emptyProof);
      setFbStep('confirm');
    });
  };

  const confirmFirebase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingFirebase) return;
    void run(async () => {
      const result = await linkFirebase(pendingFirebase.idToken, buildProof(proof, flags));
      resetFirebase();
      setNotice(
        `Compte Firebase ${result.firebaseEmail} associé. Un e-mail de confirmation vous a été envoyé.`,
      );
      await refresh();
    });
  };

  const confirmUnlink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlinking) return;
    const provider = unlinking;
    void run(async () => {
      await unlinkIdentity(provider, buildProof(proof, flags));
      setUnlinking(null);
      setProof(emptyProof);
      setNotice(`Compte ${LABEL[provider]} délié. Vos autres sessions ont été fermées.`);
      await refresh();
    });
  };

  if (!identities) {
    return error ? (
      <div className="security-page">
        <div className="security-error" role="alert">
          {error}
        </div>
      </div>
    ) : null;
  }

  /** Règle calculée par le serveur (la même que la déliaison) : jamais recalculée ici. */
  const canUnlink = (provider: IdentityProvider) => identities.canUnlink[provider];
  const lastMethodHint =
    'Dernière méthode de connexion : définissez un mot de passe ou liez une autre identité avant de la délier.';

  const row = (provider: IdentityProvider, shown: string | null, linked: boolean) => (
    <li className="security-identity" key={provider}>
      <strong>{LABEL[provider]}</strong>
      {linked ? (
        <>
          <span>{shown ?? 'adresse inconnue'}</span>
          <button
            type="button"
            className="btn-ghost"
            disabled={!canUnlink(provider) || busy}
            title={canUnlink(provider) ? undefined : lastMethodHint}
            onClick={() =>
              void run(async () => {
                await reloadIdentities();
                setUnlinking(provider);
                setProof(emptyProof);
              })
            }
          >
            <Unlink size={14} /> Délier
          </button>
          {!canUnlink(provider) && <small className="security-hint">{lastMethodHint}</small>}
        </>
      ) : provider === 'github' ? (
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() => void run(() => startGitHubAuthorization('link'))}
        >
          <Link2 size={14} /> Lier GitHub
        </button>
      ) : isFirebaseAuthConfigured ? (
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() => {
            setFbStep('signin');
            setError('');
          }}
        >
          <Link2 size={14} /> Lier Firebase
        </button>
      ) : (
        <span className="security-hint">Non disponible sur cette instance.</span>
      )}
    </li>
  );

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
      <section className="security-card" aria-label="Identités liées">
        <h3>Identités liées</h3>
        <p>
          Une identité GitHub ou Firebase permet de se connecter à ce compte ({accountEmail}). Elle
          n'est jamais liée automatiquement : chaque liaison ou déliaison demande votre mot de passe
          (ou une connexion de moins de 5 minutes) et le code de double authentification si elle est
          active, et vous est notifiée par e-mail.
        </p>
        <ul className="security-identities">
          {row('github', identities.github.username, identities.github.linked)}
          {row('firebase', identities.firebase.email, identities.firebase.linked)}
        </ul>

        {fbStep === 'signin' && (
          <form onSubmit={signInFirebase} aria-label="Connexion Firebase">
            <p>Connectez-vous au compte Firebase à lier.</p>
            <label className="security-field">
              E-mail Firebase
              <input
                className="form-input"
                type="email"
                autoComplete="off"
                value={fbEmail}
                onChange={(e) => setFbEmail(e.target.value)}
                required
              />
            </label>
            <label className="security-field">
              Mot de passe Firebase
              <input
                className="form-input"
                type="password"
                autoComplete="off"
                value={fbPassword}
                onChange={(e) => setFbPassword(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn-primary" disabled={busy}>
              Continuer
            </button>
            <button type="button" className="btn-ghost" onClick={resetFirebase}>
              Annuler
            </button>
          </form>
        )}

        {fbStep === 'confirm' && pendingFirebase && (
          <form onSubmit={confirmFirebase} aria-label="Confirmation de la liaison Firebase">
            <p>
              Vous allez lier l'adresse Firebase <strong>{pendingFirebase.email}</strong> au compte{' '}
              <strong>{accountEmail}</strong>. Cette adresse pourra ensuite se connecter à ce
              compte.
            </p>
            {pendingFirebase.email.toLowerCase() !== accountEmail.toLowerCase() && (
              <p className="security-warning" role="alert">
                <AlertTriangle size={16} /> Cette adresse est différente de celle de votre compte.
                Ne continuez que si elle vous appartient.
              </p>
            )}
            <IdentityProofFields {...flags} value={proof} onChange={setProof} />
            <button type="submit" className="btn-primary" disabled={busy}>
              Confirmer la liaison Firebase
            </button>
            <button type="button" className="btn-ghost" onClick={resetFirebase}>
              Annuler
            </button>
          </form>
        )}

        {unlinking && (
          <form onSubmit={confirmUnlink} aria-label={`Délier ${LABEL[unlinking]}`}>
            <p>
              Délier {LABEL[unlinking]} fermera vos autres sessions
              {unlinking === 'github' ? " et supprimera l'accès aux dépôts enregistré" : ''}.
            </p>
            <IdentityProofFields {...flags} value={proof} onChange={setProof} />
            <button type="submit" className="btn-primary" disabled={busy}>
              Confirmer la déliaison
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setUnlinking(null);
                setProof(emptyProof);
              }}
            >
              Annuler
            </button>
          </form>
        )}
      </section>
    </div>
  );
};
