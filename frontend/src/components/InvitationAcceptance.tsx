import React, { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { ShieldCheck, Loader, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react'
import logo from '../logo.png'
import './Login.css' // Réutiliser les styles globaux du login

interface InvitationAcceptanceProps {
  token: string
  onClose: () => void
}

export const InvitationAcceptance: React.FC<InvitationAcceptanceProps> = ({ token, onClose }) => {
  const { user, mockLogin, checkInvitation, acceptInvitation } = useApp()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteInfo, setInviteInfo] = useState<{ workspaceName: string; invitedByName: string; role: string } | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [success, setSuccess] = useState(false)

  // États pour connexion si non connecté
  const [name, setName] = useState('')

  // Charger et vérifier le token d'invitation au montage
  useEffect(() => {
    const verifyToken = async () => {
      setLoading(true)
      setError(null)
      try {
        const info = await checkInvitation(token)
        setInviteInfo(info)
      } catch (err: any) {
        console.error(err)
        setError(err.message || "Lien d'invitation invalide, expiré ou révoqué.")
      } finally {
        setLoading(false)
      }
    }

    if (token) {
      verifyToken()
    }
  }, [token])

  const handleGitHubLogin = () => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || 'votre_client_id_github'
    const redirectUri = window.location.origin
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=user,repo`
  }

  const handleBypass = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await mockLogin(name || 'Collaborateur')
    } catch (err) {
      alert("Erreur d'authentification.")
    }
  }

  const handleAccept = async () => {
    if (!token) return
    setAccepting(true)
    setError(null)
    try {
      await acceptInvitation(token)
      setSuccess(true)
    } catch (err: any) {
      console.error(err)
      setError(err.message || "Impossible d'accepter l'invitation.")
    } finally {
      setAccepting(false)
    }
  }

  const handleGoToApp = () => {
    // Nettoyer le paramètre token de l'URL
    const url = new URL(window.location.href)
    url.searchParams.delete('token')
    window.history.replaceState({}, document.title, url.pathname + url.search)
    onClose()
  }

  if (loading) {
    return (
      <div className="login-page">
        <div className="glass-panel login-card text-center" style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <Loader className="spinner-loader" size={40} color="var(--accent-primary)" />
          <h3 className="login-title" style={{ fontSize: 'var(--font-xl)' }}>Vérification de l'invitation...</h3>
          <p className="login-subtitle">Nous analysons votre lien magique de connexion sécurisée.</p>
        </div>
      </div>
    )
  }

  if (error && !success) {
    return (
      <div className="login-page">
        <div className="glass-panel login-card text-center" style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <AlertCircle size={48} color="var(--accent-primary)" />
          <div>
            <h3 className="login-title" style={{ fontSize: 'var(--font-xl)', color: 'var(--accent-primary)' }}>Invitation Invalide</h3>
            <p className="login-subtitle" style={{ marginTop: '10px' }}>{error}</p>
          </div>
          <button onClick={handleGoToApp} className="btn-primary" style={{ marginTop: '10px' }}>
            Accéder à l'application
          </button>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="login-page">
        <div className="glass-panel login-card text-center" style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <CheckCircle2 size={48} color="green" />
          <div>
            <h3 className="login-title" style={{ fontSize: 'var(--font-xl)' }}>Bienvenue à bord !</h3>
            <p className="login-subtitle" style={{ marginTop: '10px' }}>
              Vous avez rejoint avec succès l'espace de travail <strong>{inviteInfo?.workspaceName}</strong>.
            </p>
          </div>
          <button onClick={handleGoToApp} className="btn-primary" style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Accéder à mon espace <ArrowRight size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="glass-panel login-card">
        {/* App Logo */}
        <div className="login-logo">
          <img src={logo} alt="Planner-Pro Logo" />
        </div>

        <div>
          <h2 className="login-title">Planner-Pro</h2>
          <p className="login-subtitle" style={{ fontSize: 'var(--font-sm)', opacity: 0.9 }}>
            Vous êtes invité(e) par <strong>{inviteInfo?.invitedByName}</strong> à rejoindre l'espace de travail <strong>{inviteInfo?.workspaceName}</strong> avec le rôle de <strong>{inviteInfo?.role}</strong>.
          </p>
        </div>

        {!user ? (
          <>
            <div className="login-divider">
              <div className="login-divider__line"></div>
              <span className="login-divider__text">CONNECTEZ-VOUS POUR REJOINDRE</span>
              <div className="login-divider__line"></div>
            </div>

            <button onClick={handleGitHubLogin} className="github-btn">
              <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '8px' }}>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Se connecter avec GitHub
            </button>

            <div className="login-divider">
              <div className="login-divider__line"></div>
              <span className="login-divider__text">OU CRÉER UN COMPTE DE DÉMO</span>
              <div className="login-divider__line"></div>
            </div>

            <form onSubmit={handleBypass} className="bypass-form">
              <input
                type="text"
                required
                placeholder="Votre prénom / Nom complet"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="form-input"
              />
              <button type="submit" className="btn-primary">
                S'enregistrer et Continuer
              </button>
            </form>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', width: '100%' }}>
            <div style={{ padding: 'var(--space-sm)', backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>
              Vous êtes actuellement connecté(e) en tant que <strong>{user.name} ({user.email})</strong>.
            </div>

            <button
              onClick={handleAccept}
              disabled={accepting}
              className="btn-primary"
              style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
            >
              {accepting ? (
                <>
                  <span className="spinner-loader" style={{ width: '14px', height: '14px' }}></span>
                  Adhésion en cours...
                </>
              ) : (
                <>
                  <ShieldCheck size={18} />
                  Accepter l'Invitation et Rejoindre
                </>
              )}
            </button>

            <button
              onClick={handleGoToApp}
              className="btn-text"
              style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}
            >
              Annuler et retourner au Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
