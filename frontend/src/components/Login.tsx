import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { isFirebaseAuthConfigured } from '../firebase-config';
import logo from '../logo.png';
import './Login.css';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const Login: React.FC<{ oauthError?: string; isLoadingOAuth?: boolean }> = ({
  oauthError,
  isLoadingOAuth = false,
}) => {
  const { mockLogin, classicLogin, classicRegister, firebaseLogin, verifyMfa, discoverSso } =
    useApp();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isSsoMode, setIsSsoMode] = useState(false);
  // Onglet SSO masqué tant que le serveur n'a pas confirmé que la fonctionnalité est active (P3)
  const [ssoFeatureEnabled, setSsoFeatureEnabled] = useState(false);
  const [authProvider, setAuthProvider] = useState<'firebase' | 'legacy'>(
    isFirebaseAuthConfigured ? 'firebase' : 'legacy',
  );

  // MFA states
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaTicket, setMfaTicket] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  // SSO discovery states
  const [ssoEmail, setSsoEmail] = useState('');
  const [ssoResult, setSsoResult] = useState<{
    ssoAvailable: boolean;
    domain?: string;
    workspaceName?: string;
    provider?: string;
    authUrl?: string;
  } | null>(null);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Local bypass fields
  const [bypassName, setBypassName] = useState('');

  // UI states
  const [errorMsg, setErrorMsg] = useState(oauthError ?? '');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/features`)
      .then((res) => (res.ok ? res.json() : { sso: false }))
      .then((flags: { sso?: boolean }) => {
        if (!cancelled) setSsoFeatureEnabled(flags.sso === true);
      })
      .catch(() => {
        if (!cancelled) setSsoFeatureEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGitHubLogin = () => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || 'votre_client_id_github';
    const redirectUri = window.location.origin;
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=user,repo`;
  };

  const handleBypass = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      await mockLogin(bypassName || 'Gaëtan');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Échec de la simulation de connexion');
    } finally {
      setLoading(false);
    }
  };

  const handleClassicLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      setErrorMsg('Veuillez remplir tous les champs.');
      return;
    }
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await classicLogin(loginEmail, loginPassword);
      if (res?.mfaRequired && res.mfaTicket) {
        setMfaTicket(res.mfaTicket);
        setMfaStep(true);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Identifiants incorrects.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaCode || mfaCode.length !== 6) {
      setErrorMsg('Veuillez saisir un code TOTP à 6 chiffres.');
      return;
    }
    setErrorMsg('');
    setLoading(true);
    try {
      await verifyMfa(mfaTicket, mfaCode);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Code de vérification invalide.');
    } finally {
      setLoading(false);
    }
  };

  const handleSsoDiscovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ssoEmail || !ssoEmail.includes('@')) {
      setErrorMsg('Veuillez entrer une adresse e-mail professionnelle valide.');
      return;
    }
    setErrorMsg('');
    setLoading(true);
    try {
      const result = await discoverSso(ssoEmail);
      if (!result.ssoAvailable) {
        setErrorMsg(`Aucun fournisseur SSO configuré pour ce domaine. Contactez l'administrateur.`);
        setSsoResult(null);
      } else {
        setSsoResult(result);
        if (result.authUrl) {
          window.location.href = result.authUrl;
        }
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de la découverte SSO.');
    } finally {
      setLoading(false);
    }
  };

  const handleClassicRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName || !regEmail || !regPassword) {
      setErrorMsg('Veuillez remplir tous les champs.');
      return;
    }
    if (regPassword.length < 6) {
      setErrorMsg('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }
    setErrorMsg('');
    setLoading(true);
    try {
      await classicRegister(regEmail, regPassword, regName);
      // L'inscription déclenchera automatiquement la connexion et l'onboarding côté backend
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'inscription.");
    } finally {
      setLoading(false);
    }
  };

  const handleFirebaseAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = isRegisterMode ? regEmail : loginEmail;
    const password = isRegisterMode ? regPassword : loginPassword;
    if (!email || !password || (isRegisterMode && !regName)) {
      setErrorMsg('Veuillez remplir tous les champs.');
      return;
    }

    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const [
        {
          createUserWithEmailAndPassword,
          reload,
          sendEmailVerification,
          signInWithEmailAndPassword,
          updateProfile,
        },
        { getFirebaseAuth },
      ] = await Promise.all([import('firebase/auth'), import('../firebase-auth')]);
      const auth = getFirebaseAuth();
      if (isRegisterMode) {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(credential.user, { displayName: regName.trim() });
        await sendEmailVerification(credential.user);
        setIsRegisterMode(false);
        setInfoMsg('Compte créé. Vérifie ton adresse e-mail avant de te connecter.');
        return;
      }

      const credential = await signInWithEmailAndPassword(auth, email, password);
      await reload(credential.user);
      if (!credential.user.emailVerified) {
        await sendEmailVerification(credential.user);
        setInfoMsg('Vérifie ton adresse e-mail. Nous venons de renvoyer le lien de confirmation.');
        return;
      }

      await firebaseLogin(
        await credential.user.getIdToken(),
        credential.user.displayName || undefined,
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Échec de connexion Firebase.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="background-decorations">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
      </div>

      <div className="glass-panel login-card">
        {/* App Logo */}
        <div className="login-logo-container">
          <img src={logo} alt="Planner-Pro Logo" className="login-logo" />
        </div>

        {/* Text Header */}
        <div className="login-header-text">
          <h2 className="login-title">Planner-Pro</h2>
          <p className="login-subtitle">
            Le hub de planification immersif pour ingénieurs d'élite.
          </p>
        </div>

        {isFirebaseAuthConfigured && (
          <div className="auth-tabs" aria-label="Type de compte">
            <button
              className={`auth-tab ${authProvider === 'firebase' ? 'auth-tab--active' : ''}`}
              type="button"
              onClick={() => {
                setAuthProvider('firebase');
                setErrorMsg('');
                setInfoMsg('');
              }}
            >
              Firebase
            </button>
            <button
              className={`auth-tab ${authProvider === 'legacy' ? 'auth-tab--active' : ''}`}
              type="button"
              onClick={() => {
                setAuthProvider('legacy');
                setErrorMsg('');
                setInfoMsg('');
              }}
            >
              Compte existant
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        {!mfaStep && (
          <div className="auth-tabs">
            <button
              className={`auth-tab ${!isRegisterMode && !isSsoMode ? 'auth-tab--active' : ''}`}
              onClick={() => {
                setIsRegisterMode(false);
                setIsSsoMode(false);
                setErrorMsg('');
              }}
            >
              Se connecter
            </button>
            <button
              className={`auth-tab ${isRegisterMode ? 'auth-tab--active' : ''}`}
              onClick={() => {
                setIsRegisterMode(true);
                setIsSsoMode(false);
                setErrorMsg('');
              }}
            >
              S'inscrire
            </button>
            {ssoFeatureEnabled && (
              <button
                className={`auth-tab ${isSsoMode ? 'auth-tab--active' : ''}`}
                onClick={() => {
                  setIsSsoMode(true);
                  setIsRegisterMode(false);
                  setErrorMsg('');
                }}
              >
                SSO Entreprise
              </button>
            )}
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="auth-error">
            <span className="auth-error-icon">⚠️</span>
            <span className="auth-error-text">{errorMsg}</span>
          </div>
        )}
        {infoMsg && (
          <p className="auth-info" role="status">
            {infoMsg}
          </p>
        )}
        {isLoadingOAuth && <p role="status">Connexion à GitHub en cours…</p>}

        {/* Forms Container */}
        <div className="auth-forms-wrapper">
          {mfaStep ? (
            /* Écran Challenge MFA TOTP */
            <form onSubmit={handleVerifyMfa} className="auth-form fade-in">
              <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔐</div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
                  Validation en deux étapes
                </h3>
                <p style={{ fontSize: '0.875rem', opacity: 0.8, marginTop: '0.35rem' }}>
                  Entrez le code à 6 chiffres généré par votre application Authenticator.
                </p>
              </div>

              <div className="form-group">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="000000"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  className="form-input"
                  style={{
                    textAlign: 'center',
                    fontSize: '1.5rem',
                    letterSpacing: '0.35rem',
                    fontWeight: 'bold',
                  }}
                  autoFocus
                  required
                />
              </div>

              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={loading || mfaCode.length !== 6}
              >
                {loading ? 'Vérification...' : 'Valider la connexion'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMfaStep(false);
                  setMfaTicket('');
                  setMfaCode('');
                }}
                className="btn-secondary"
                style={{ width: '100%', marginTop: '0.75rem', padding: '0.65rem' }}
              >
                Annuler
              </button>
            </form>
          ) : isSsoMode && ssoFeatureEnabled ? (
            /* Formulaire SSO Entreprise */
            <form onSubmit={handleSsoDiscovery} className="auth-form fade-in">
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.875rem', opacity: 0.85, margin: 0 }}>
                  Accédez à votre espace avec vos identifiants d'entreprise (Microsoft Azure AD,
                  Google Workspace ou SAML 2.0).
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Adresse e-mail professionnelle</label>
                <input
                  type="email"
                  placeholder="collaborateur@organisation.com"
                  value={ssoEmail}
                  onChange={(e) => setSsoEmail(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              {ssoResult?.ssoAvailable && (
                <div
                  style={{
                    padding: '0.75rem',
                    borderRadius: '8px',
                    background: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    marginBottom: '1rem',
                    fontSize: '0.85rem',
                  }}
                >
                  🏢 <strong>{ssoResult.workspaceName}</strong> ({ssoResult.provider})
                </div>
              )}

              <button type="submit" className="btn-primary auth-submit-btn" disabled={loading}>
                {loading ? 'Détection en cours...' : 'Continuer avec le SSO Entreprise'}
              </button>
            </form>
          ) : authProvider === 'firebase' ? (
            <form onSubmit={handleFirebaseAuth} className="auth-form fade-in">
              {isRegisterMode && (
                <div className="form-group">
                  <label className="form-label" htmlFor="firebase-register-name">
                    Nom complet
                  </label>
                  <input
                    id="firebase-register-name"
                    type="text"
                    placeholder="Ada Lovelace"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>
              )}
              <div className="form-group">
                <label className="form-label" htmlFor="firebase-email">
                  Adresse e-mail
                </label>
                <input
                  id="firebase-email"
                  type="email"
                  placeholder="nom@entreprise.com"
                  value={isRegisterMode ? regEmail : loginEmail}
                  onChange={(e) =>
                    isRegisterMode ? setRegEmail(e.target.value) : setLoginEmail(e.target.value)
                  }
                  className="form-input"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="firebase-password">
                  Mot de passe
                </label>
                <input
                  id="firebase-password"
                  type="password"
                  placeholder={isRegisterMode ? 'Min. 6 caractères' : '••••••••'}
                  value={isRegisterMode ? regPassword : loginPassword}
                  onChange={(e) =>
                    isRegisterMode
                      ? setRegPassword(e.target.value)
                      : setLoginPassword(e.target.value)
                  }
                  className="form-input"
                  required
                />
              </div>
              <button type="submit" className="btn-primary auth-submit-btn" disabled={loading}>
                {loading
                  ? 'Connexion en cours...'
                  : isRegisterMode
                    ? 'Créer un compte Firebase'
                    : 'Se connecter avec Firebase'}
              </button>
            </form>
          ) : !isRegisterMode ? (
            /* Login Form */
            <form onSubmit={handleClassicLogin} className="auth-form fade-in">
              <div className="form-group">
                <label className="form-label">Adresse E-mail</label>
                <input
                  type="email"
                  placeholder="nom@entreprise.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <div className="label-row">
                  <label className="form-label">Mot de passe</label>
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <button type="submit" className="btn-primary auth-submit-btn" disabled={loading}>
                {loading ? 'Connexion en cours...' : 'Se connecter'}
              </button>
            </form>
          ) : (
            /* Register Form */
            <form onSubmit={handleClassicRegister} className="auth-form fade-in">
              <div className="form-group">
                <label className="form-label">Nom complet</label>
                <input
                  type="text"
                  placeholder="Ada Lovelace"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Adresse E-mail</label>
                <input
                  type="email"
                  placeholder="ada@plannerpro.link"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Mot de passe</label>
                <input
                  type="password"
                  placeholder="Min. 6 caractères"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <button type="submit" className="btn-primary auth-submit-btn" disabled={loading}>
                {loading ? 'Création du compte...' : 'Créer un compte professionnel'}
              </button>
            </form>
          )}
        </div>

        {/* Divider */}
        <div className="login-divider">
          <div className="login-divider__line"></div>
          <span className="login-divider__text">OU CONTINUER AVEC</span>
          <div className="login-divider__line"></div>
        </div>

        {/* GitHub SSO */}
        <button onClick={handleGitHubLogin} className="github-btn" type="button">
          <svg height="18" width="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub SSO
        </button>

        {/* Local bypass mode */}
        <div className="bypass-section">
          <details className="bypass-details">
            <summary className="bypass-summary">Simuler une session locale (Dev)</summary>
            <form onSubmit={handleBypass} className="bypass-form">
              <input
                type="text"
                placeholder="Entrez votre prénom"
                value={bypassName}
                onChange={(e) => setBypassName(e.target.value)}
                className="form-input form-input-sm"
              />
              <button type="submit" className="btn-secondary btn-sm btn-block">
                Simuler Connexion
              </button>
            </form>
          </details>
        </div>
      </div>
    </div>
  );
};
