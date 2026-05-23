import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import { FolderGit2 } from 'lucide-react'

export const Login: React.FC = () => {
  const { mockLogin } = useApp()
  const [name, setName] = useState('')

  const handleGitHubLogin = () => {
    // Redirection vers OAuth GitHub (simulé ou réel en fonction de l'environnement)
    const clientId = 'votre_client_id_github' // Remplacer par la clé réelle
    const redirectUri = window.location.origin
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=user,repo`
  }

  const handleBypass = (e: React.FormEvent) => {
    e.preventDefault()
    mockLogin(name || 'Gaëtan')
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'radial-gradient(circle at top right, rgba(99, 102, 241, 0.15), var(--bg-primary))',
      padding: '24px'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '440px',
        padding: '40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '32px',
        textAlign: 'center'
      }}>
        {/* App Logo */}
        <div style={{
          background: 'var(--accent-gradient)',
          width: '64px',
          height: '64px',
          borderRadius: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--accent-glow)'
        }}>
          <FolderGit2 size={32} color="#fff" />
        </div>

        {/* Text */}
        <div>
          <h2 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px', marginBottom: '8px' }}>Planner-Pro</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Le hub de planification immersif pour ingénieurs d'élite.
          </p>
        </div>

        {/* Main SSO Login */}
        <button
          onClick={handleGitHubLogin}
          style={{
            width: '100%',
            backgroundColor: '#24292e',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            transition: 'background-color 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1c1f23'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#24292e'}
        >
          <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Se connecter avec GitHub
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '16px' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--glass-border)' }}></div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>OU TESTER EN LOCAL</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--glass-border)' }}></div>
        </div>

        {/* Bypass Mode */}
        <form onSubmit={handleBypass} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input
            type="text"
            placeholder="Votre prénom / Pseudo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              color: '#fff',
              fontFamily: 'var(--font-primary)',
              fontSize: '14px',
              outline: 'none'
            }}
          />
          <button type="submit" className="btn-primary" style={{ justifyContent: 'center' }}>
            Accéder à Planner-Pro (Simulation)
          </button>
        </form>
      </div>
    </div>
  )
}
