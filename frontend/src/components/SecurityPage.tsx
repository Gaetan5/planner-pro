import React, { useCallback, useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { ShieldCheck, ShieldOff, Download, AlertTriangle } from 'lucide-react';
import {
  SecurityApiError,
  confirmMfa,
  disableMfa,
  getMfaStatus,
  regenerateRecoveryCodes,
  setupMfa,
  type MfaSetup,
  type MfaStatus,
} from '../security-api';
import { setUnsavedCodes } from '../unsaved-codes';
import './SecurityPage.css';

/** QR code généré localement : l'URI `otpauth://` (qui contient le secret) ne quitte jamais l'app. */
function qrDataUrl(authUri: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(authUri);
  qr.make();
  return qr.createDataURL(5, 2);
}

/** Message affiché pour une erreur d'API ; un 403 sans mot de passe demande une reconnexion. */
function describeError(err: unknown, hasPassword: boolean): string {
  if (err instanceof SecurityApiError) {
    if (err.status === 403 && !hasPassword) {
      return `Reconnectez-vous puis réessayez : cette action exige une connexion de moins de 5 minutes. (${err.message})`;
    }
    return err.message;
  }
  return 'La demande a échoué. Réessayez plus tard.';
}

/** Codes de récupération : affichés une seule fois, fermeture après confirmation explicite. */
const RecoveryCodesPanel: React.FC<{ codes: string[]; onClose: () => void }> = ({
  codes,
  onClose,
}) => {
  const [saved, setSaved] = useState(false);

  // Tant que les codes sont à l'écran : confirmation avant de quitter (P9-MFA-e)
  useEffect(() => {
    setUnsavedCodes(true);
    return () => setUnsavedCodes(false);
  }, []);

  const download = () => {
    const blob = new Blob(
      [`Planner-Pro : codes de récupération (usage unique)\n\n${codes.join('\n')}\n`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'planner-pro-codes-de-recuperation.txt';
    // Safari exige un lien présent dans le DOM et une révocation différée
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="security-card" role="region" aria-label="Codes de récupération">
      <h3>Codes de récupération</h3>
      <p className="security-warning">
        <AlertTriangle size={16} /> Ces codes ne seront plus jamais affichés. Chacun ne sert qu'une
        fois, si vous perdez votre application d'authentification.
      </p>
      <ul className="security-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-ghost" onClick={download}>
        <Download size={14} /> Télécharger (.txt)
      </button>
      <label className="security-confirm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        J'ai conservé ces codes en lieu sûr
      </label>
      <button type="button" className="btn-primary" disabled={!saved} onClick={onClose}>
        Terminer
      </button>
    </div>
  );
};

export const SecurityPage: React.FC = () => {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'idle' | 'disable' | 'regenerate'>('idle');
  const [useRecovery, setUseRecovery] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getMfaStatus());
      setLoadError('');
    } catch (err) {
      setLoadError(describeError(err, true));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const qrUrl = useMemo(() => (setup ? qrDataUrl(setup.authUri) : ''), [setup]);
  const hasPassword = status?.hasPassword ?? true;

  const resetForm = () => {
    setPassword('');
    setCode('');
    setMode('idle');
    setUseRecovery(false);
  };

  const run = async (action: () => Promise<void>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(describeError(err, hasPassword));
    } finally {
      setBusy(false);
    }
  };

  const startSetup = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSetup(await setupMfa(hasPassword ? password : undefined));
      setPassword('');
    });
  };

  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await confirmMfa(code);
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setCode('');
      setStatus((current) => (current ? { ...current, mfaEnabled: true } : current));
    });
  };

  const disable = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await disableMfa(
        useRecovery ? { recoveryCode: code } : { code },
        hasPassword ? password : undefined,
      );
      resetForm();
      setNotice(
        'Authentification à deux facteurs désactivée. Vos autres sessions ont été fermées.',
      );
      await refresh();
    });
  };

  const regenerate = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await regenerateRecoveryCodes(code, hasPassword ? password : undefined);
      setRecoveryCodes(result.recoveryCodes);
      resetForm();
    });
  };

  const needsPassword = hasPassword && (
    <label className="security-field">
      Mot de passe
      <input
        className="form-input"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
    </label>
  );

  return (
    <div className="security-page">
      <h2 className="security-title">
        <ShieldCheck size={22} /> Sécurité du compte
      </h2>

      {loadError && (
        <div className="security-error" role="alert">
          {loadError}
        </div>
      )}
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

      {recoveryCodes && (
        <RecoveryCodesPanel codes={recoveryCodes} onClose={() => setRecoveryCodes(null)} />
      )}

      {status && !recoveryCodes && (
        <section className="security-card">
          <h3>Authentification à deux facteurs (TOTP)</h3>

          {!status.mfaEnabled && !setup && (
            <form onSubmit={startSetup}>
              <p>
                Protégez votre compte avec une application d'authentification (Google Authenticator,
                Aegis, 1Password…). Elle est obligatoire pour administrer la plateforme.
              </p>
              {!status.hasPassword && (
                <p className="security-hint">
                  Votre compte n'a pas de mot de passe : l'activation exige une connexion de moins
                  de 5 minutes. Sinon, reconnectez-vous puis réessayez.
                </p>
              )}
              {needsPassword}
              <button type="submit" className="btn-primary" disabled={busy}>
                Activer l'authentification à deux facteurs
              </button>
            </form>
          )}

          {!status.mfaEnabled && setup && (
            <form onSubmit={confirm}>
              <p>1. Scannez ce QR code avec votre application, ou saisissez la clé manuellement.</p>
              <img className="security-qr" src={qrUrl} alt="QR code d'activation TOTP" />
              <p>
                Clé secrète : <code className="security-secret">{setup.secret}</code>
              </p>
              <label className="security-field">
                2. Code à 6 chiffres affiché par l'application
                <input
                  className="form-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className="btn-primary" disabled={busy}>
                Confirmer l'activation
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setSetup(null);
                  setCode('');
                  setError('');
                }}
              >
                Annuler
              </button>
            </form>
          )}

          {status.mfaEnabled && mode === 'idle' && (
            <div>
              <p className="security-on">
                <ShieldCheck size={16} /> L'authentification à deux facteurs est activée.
              </p>
              <button type="button" className="btn-ghost" onClick={() => setMode('regenerate')}>
                Régénérer les codes de récupération
              </button>
              <button type="button" className="btn-ghost" onClick={() => setMode('disable')}>
                <ShieldOff size={14} /> Désactiver
              </button>
            </div>
          )}

          {status.mfaEnabled && mode === 'disable' && (
            <form onSubmit={disable}>
              <p>
                Pour désactiver, saisissez un code actuel
                {hasPassword
                  ? ' et votre mot de passe'
                  : ' (connexion de moins de 5 minutes requise)'}
                .
              </p>
              <label className="security-field">
                {useRecovery ? 'Code de récupération' : 'Code à 6 chiffres'}
                <input
                  className="form-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setCode('');
                }}
              >
                {useRecovery
                  ? "Utiliser le code de l'application"
                  : 'Utiliser un code de récupération'}
              </button>
              {needsPassword}
              <button type="submit" className="btn-primary" disabled={busy}>
                Désactiver l'authentification à deux facteurs
              </button>
              <button type="button" className="btn-ghost" onClick={resetForm}>
                Annuler
              </button>
            </form>
          )}

          {status.mfaEnabled && mode === 'regenerate' && (
            <form onSubmit={regenerate}>
              <p>
                Les anciens codes seront invalidés. Saisissez un code actuel
                {hasPassword
                  ? ' et votre mot de passe'
                  : ' (connexion de moins de 5 minutes requise)'}
                .
              </p>
              <label className="security-field">
                Code à 6 chiffres
                <input
                  className="form-input"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </label>
              {needsPassword}
              <button type="submit" className="btn-primary" disabled={busy}>
                Générer de nouveaux codes
              </button>
              <button type="button" className="btn-ghost" onClick={resetForm}>
                Annuler
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
};
