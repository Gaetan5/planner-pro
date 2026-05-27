import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import logo from '../logo.png'
import './Login.css'

export const Login: React.FC = () => {
  const { mockLogin } = useApp()
  const [name, setName] = useState('')

  const handleGitHubLogin = () => {
    // Redirection vers OAuth GitHub (simulé ou réel en fonction de l'environnement)
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || 'votre_client_id_github'
    const redirectUri = window.location.origin
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=user,repo`
  }

  const handleBypass = (e: React.FormEvent) => {
    e.preventDefault()
    mockLogin(name || 'Gaëtan')
  }

  return (
    <div className="login-page">
      <div className="glass-panel login-card">
        {/* App Logo */}
        <div className="login-logo">
          <img src={logo} alt="Planner-Pro Logo" />
        </div>

        {/* Text */}
        <div>
          <h2 className="login-title">Planner-Pro</h2>
          <p className="login-subtitle">
            Le hub de planification immersif pour ingénieurs d'élite.
          </p>
        </div>

        {/* Main SSO Login */}
        <button
          onClick={handleGitHubLogin}
          className="github-btn"
        >
          <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Se connecter avec GitHub
        </button>

        {/* Divider */}
        <div className="login-divider">
          <div className="login-divider__line"></div>
          <span className="login-divider__text">OU TESTER EN LOCAL</span>
          <div className="login-divider__line"></div>
        </div>

        {/* Bypass Mode */}
        <form onSubmit={handleBypass} className="bypass-form">
          <input
            type="text"
            placeholder="Votre prénom / Pseudo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form-input"
          />
          <button type="submit" className="btn-primary">
            Accéder à Planner-Pro (Simulation)
          </button>
        </form>
      </div>
    </div>
  )
}
