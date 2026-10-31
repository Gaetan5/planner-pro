import React, { useState } from 'react';
import { resetPassword, verifyEmail, type AccountLink } from '../account-api';
import logo from '../logo.png';
import './Login.css';

/**
 * Page ouverte depuis un lien reçu par e-mail (P6) : confirmation d'adresse ou choix d'un nouveau
 * mot de passe. L'action n'est déclenchée que par un clic (les scanners de liens ne consomment
 * pas le jeton).
 */
export const AccountLinkPage: React.FC<{ link: AccountLink; onDone: () => void }> = ({
  link,
  onDone,
}) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (link.kind === 'reset') {
      if (password.length < 10) {
        setError('Le mot de passe doit contenir au moins 10 caractères.');
        return;
      }
      if (password !== confirm) {
        setError('Les deux mots de passe ne correspondent pas.');
        return;
      }
    }
    setLoading(true);
    try {
      setSuccess(
        link.kind === 'verify'
          ? await verifyEmail(link.token)
          : await resetPassword(link.token, password),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lien invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="glass-panel login-card">
        <div className="login-logo-container">
          <img src={logo} alt="Planner-Pro Logo" className="login-logo" />
        </div>
        <div className="login-header-text">
          <h2 className="login-title">
            {link.kind === 'verify' ? "Confirmation de l'adresse e-mail" : 'Nouveau mot de passe'}
          </h2>
        </div>
        {error && (
          <div className="auth-error" role="alert">
            <span className="auth-error-text">{error}</span>
          </div>
        )}
        {success ? (
          <div className="auth-form">
            <p>{success}</p>
            <button type="button" className="btn-primary auth-submit-btn" onClick={onDone}>
              Aller à la connexion
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="auth-form">
            {link.kind === 'reset' && (
              <>
                <div className="form-group">
                  <label className="form-label" htmlFor="reset-password">
                    Nouveau mot de passe
                  </label>
                  <input
                    id="reset-password"
                    type="password"
                    className="form-input"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="reset-confirm">
                    Confirmer le mot de passe
                  </label>
                  <input
                    id="reset-confirm"
                    type="password"
                    className="form-input"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
              </>
            )}
            <button type="submit" className="btn-primary auth-submit-btn" disabled={loading}>
              {loading
                ? 'Veuillez patienter...'
                : link.kind === 'verify'
                  ? 'Confirmer mon adresse'
                  : 'Changer le mot de passe'}
            </button>
            <button type="button" className="btn-secondary" onClick={onDone}>
              Retour à la connexion
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
