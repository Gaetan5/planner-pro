import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import logo from '../logo.png'
import './Login.css'

export const Login: React.FC = () => {
  const { mockLogin, classicLogin, classicRegister } = useApp()
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  
  // Login fields
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  
  // Register fields
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  
  // Local bypass fields
  const [bypassName, setBypassName] = useState('')
  
  // UI states
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGitHubLogin = () => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || 'votre_client_id_github'
    const redirectUri = window.location.origin
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=user,repo`
  }

  const handleBypass = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    setLoading(true)
    try {
      await mockLogin(bypassName || 'Gaëtan')
    } catch (err: any) {
      setErrorMsg(err.message || 'Échec de la simulation de connexion')
    } finally {
      setLoading(false)
    }
  }

  const handleClassicLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginEmail || !loginPassword) {
      setErrorMsg('Veuillez remplir tous les champs.')
      return
    }
    setErrorMsg('')
    setLoading(true)
    try {
      await classicLogin(loginEmail, loginPassword)
    } catch (err: any) {
      setErrorMsg(err.message || 'Identifiants incorrects.')
    } finally {
      setLoading(false)
    }
  }

  const handleClassicRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!regName || !regEmail || !regPassword) {
      setErrorMsg('Veuillez remplir tous les champs.')
      return
    }
    if (regPassword.length < 6) {
      setErrorMsg('Le mot de passe doit faire au moins 6 caractères.')
      return
    }
    setErrorMsg('')
    setLoading(true)
    try {
      await classicRegister(regEmail, regPassword, regName)
      // L'inscription déclenchera automatiquement la connexion et l'onboarding côté backend
    } catch (err: any) {
      setErrorMsg(err.message || "Erreur lors de l'inscription.")
    } finally {
      setLoading(false)
    }
  }

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

        {/* Navigation Tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${!isRegisterMode ? 'auth-tab--active' : ''}`}
            onClick={() => {
              setIsRegisterMode(false)
              setErrorMsg('')
            }}
          >
            Se connecter
          </button>
          <button
            className={`auth-tab ${isRegisterMode ? 'auth-tab--active' : ''}`}
            onClick={() => {
              setIsRegisterMode(true)
              setErrorMsg('')
            }}
          >
            S'inscrire
          </button>
        </div>

        {/* Error Notification */}
        {errorMsg && (
          <div className="auth-error">
            <span className="auth-error-icon">⚠️</span>
            <span className="auth-error-text">{errorMsg}</span>
          </div>
        )}

        {/* Forms Container */}
        <div className="auth-forms-wrapper">
          {!isRegisterMode ? (
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

              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={loading}
              >
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

              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={loading}
              >
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
        <button
          onClick={handleGitHubLogin}
          className="github-btn"
          type="button"
        >
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
  )
}
