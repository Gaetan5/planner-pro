import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Login } from './Login';
import { InvitationApiError, clearPendingInvite, savePendingInvite } from '../invitation-store';
import { ShieldCheck, Loader, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import logo from '../logo.png';
import './Login.css'; // Réutiliser les styles globaux du login

interface InvitationAcceptanceProps {
  token: string;
  onClose: () => void;
  /** Retour OAuth (GitHub, SSO) en erreur, ou défi MFA en cours : on revient directement à `Login`. */
  oauthError?: string;
  initialMfaTicket?: string;
}

export const InvitationAcceptance: React.FC<InvitationAcceptanceProps> = ({
  token,
  onClose,
  oauthError,
  initialMfaTicket,
}) => {
  const { user, logout, checkInvitation, acceptInvitation } = useApp();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{
    workspaceName: string;
    invitedByName: string;
    role: string;
    projectName?: string | null;
    projectId?: string | null;
    email?: string | null;
  } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Authentification par le composant `Login` existant (aucun formulaire dupliqué ici, P13-b)
  const [showLogin, setShowLogin] = useState(Boolean(oauthError || initialMfaTicket));
  // Un retour OAuth en erreur ou un défi MFA tardif ramène à `Login`, même si l'écran était déjà monté
  useEffect(() => {
    if (oauthError || initialMfaTicket) setShowLogin(true);
  }, [oauthError, initialMfaTicket]);
  // 403 : l'adresse du compte connecté ne correspond pas à celle de l'invitation (S17)
  const [mismatch, setMismatch] = useState(false);

  // Charger et vérifier le token d'invitation au montage
  useEffect(() => {
    const verifyToken = async () => {
      setLoading(true);
      setError(null);
      try {
        const info = await checkInvitation(token);
        setInviteInfo(info);
      } catch (err: unknown) {
        console.error(err);
        const message =
          err instanceof Error ? err.message : "Lien d'invitation invalide, expiré ou révoqué.";
        setError(message);
        // Jeton invalide, expiré ou révoqué : inutile de le garder
        clearPendingInvite();
      } finally {
        setLoading(false);
      }
    };

    if (token) {
      verifyToken();
    }
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptInvitation(token);
      clearPendingInvite();
      setSuccess(true);
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Impossible d'accepter l'invitation.";
      if (err instanceof InvitationApiError && err.status === 403) {
        setMismatch(true);
      } else {
        clearPendingInvite();
      }
      setError(message);
    } finally {
      setAccepting(false);
    }
  };

  // Quitter l'invitation (acceptée, ignorée ou invalide) : le jeton n'est plus nécessaire
  const handleGoToApp = () => {
    clearPendingInvite();
    onClose();
  };

  // « Changer de compte » : déconnexion qui conserve l'invitation en attente (P13-c)
  const handleChangeAccount = () => {
    savePendingInvite(token);
    setMismatch(false);
    setError(null);
    logout();
  };

  if (loading) {
    return (
      <div className="login-page">
        <div
          className="glass-panel login-card text-center"
          style={{
            padding: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
          }}
        >
          <Loader className="spinner-loader" size={40} color="var(--accent-primary)" />
          <h3 className="login-title" style={{ fontSize: 'var(--font-xl)' }}>
            Vérification de l'invitation...
          </h3>
          <p className="login-subtitle">
            Nous analysons votre lien magique de connexion sécurisée.
          </p>
        </div>
      </div>
    );
  }

  if (mismatch && !success) {
    return (
      <div className="login-page">
        <div className="glass-panel login-card" role="alert">
          <AlertCircle size={48} color="var(--accent-primary)" />
          <h3 className="login-title" style={{ fontSize: 'var(--font-xl)' }}>
            Cette invitation est destinée à une autre adresse
          </h3>
          <p className="login-subtitle">{error}</p>
          {inviteInfo?.email && (
            <p className="login-subtitle">
              Adresse invitée : <strong>{inviteInfo.email}</strong>
            </p>
          )}
          <button onClick={handleChangeAccount} className="btn-primary">
            Changer de compte
          </button>
          <button onClick={handleGoToApp} className="btn-text">
            Ignorer l'invitation
          </button>
        </div>
      </div>
    );
  }

  if (!user && showLogin) {
    return (
      <Login
        oauthError={oauthError}
        initialMfaTicket={initialMfaTicket}
        invitation={
          // Bandeau seulement quand les informations de l'invitation sont chargées (P13-f)
          inviteInfo
            ? {
                workspaceName: inviteInfo.workspaceName,
                maskedEmail: inviteInfo.email,
                onBack: () => setShowLogin(false),
              }
            : undefined
        }
      />
    );
  }

  if (error && !success) {
    return (
      <div className="login-page">
        <div
          className="glass-panel login-card text-center"
          style={{
            padding: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
          }}
        >
          <AlertCircle size={48} color="var(--accent-primary)" />
          <div>
            <h3
              className="login-title"
              style={{ fontSize: 'var(--font-xl)', color: 'var(--accent-primary)' }}
            >
              Invitation Invalide
            </h3>
            <p className="login-subtitle" style={{ marginTop: '10px' }}>
              {error}
            </p>
          </div>
          <button onClick={handleGoToApp} className="btn-primary" style={{ marginTop: '10px' }}>
            Accéder à l'application
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="login-page">
        <div
          className="glass-panel login-card text-center"
          style={{
            padding: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
          }}
        >
          <CheckCircle2 size={48} color="green" />
          <div>
            <h3 className="login-title" style={{ fontSize: 'var(--font-xl)' }}>
              Bienvenue à bord !
            </h3>
            <p className="login-subtitle" style={{ marginTop: '10px' }}>
              {inviteInfo?.projectName ? (
                <>
                  Vous avez rejoint avec succès le projet <strong>{inviteInfo.projectName}</strong>{' '}
                  de l'espace <strong>{inviteInfo.workspaceName}</strong>.
                </>
              ) : (
                <>
                  Vous avez rejoint avec succès l'espace de travail{' '}
                  <strong>{inviteInfo?.workspaceName}</strong>.
                </>
              )}
            </p>
          </div>
          <button
            onClick={handleGoToApp}
            className="btn-primary"
            style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            Accéder à mon espace <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  const roleLabel =
    inviteInfo?.role === 'VIEWER'
      ? 'Client (Consultation)'
      : inviteInfo?.role === 'ADMIN'
        ? 'Administrateur'
        : 'Contributeur';

  return (
    <div className="login-page">
      <div className="glass-panel login-card">
        {/* App Logo */}
        <div className="login-logo-container">
          <img src={logo} alt="Planner-Pro Logo" className="login-logo" />
        </div>

        <div>
          <h2 className="login-title">Planner-Pro</h2>
          <p className="login-subtitle" style={{ fontSize: 'var(--font-sm)', opacity: 0.9 }}>
            {inviteInfo?.projectName ? (
              <>
                Vous êtes invité(e) par <strong>{inviteInfo?.invitedByName}</strong> à collaborer
                sur le projet <strong>{inviteInfo.projectName}</strong> (Espace{' '}
                <strong>{inviteInfo.workspaceName}</strong>) avec le rôle de{' '}
                <strong>{roleLabel}</strong>.
              </>
            ) : (
              <>
                Vous êtes invité(e) par <strong>{inviteInfo?.invitedByName}</strong> à rejoindre
                l'espace de travail <strong>{inviteInfo?.workspaceName}</strong> avec le rôle de{' '}
                <strong>{roleLabel}</strong>.
              </>
            )}
          </p>
        </div>

        {!user ? (
          <>
            {inviteInfo?.email && (
              <p className="login-subtitle">
                Invitation destinée à l'adresse <strong>{inviteInfo.email}</strong>.
              </p>
            )}
            <button onClick={() => setShowLogin(true)} className="btn-primary">
              Se connecter ou créer un compte
            </button>
            <button onClick={handleGoToApp} className="btn-text">
              Ignorer l'invitation
            </button>
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-md)',
              width: '100%',
            }}
          >
            <div
              style={{
                padding: 'var(--space-sm)',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                fontSize: 'var(--font-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              <div>
                Vous êtes actuellement connecté(e) en tant que{' '}
                <strong>
                  {user.name} ({user.email})
                </strong>
                .
              </div>
              <div style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={logout}
                  className="btn-text"
                  style={{
                    color: 'var(--accent-primary)',
                    fontSize: 'var(--font-xs)',
                    textDecoration: 'underline',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  Ce n'est pas vous ? Se déconnecter pour changer de compte
                </button>
              </div>
            </div>

            <button
              onClick={handleAccept}
              disabled={accepting}
              className="btn-primary"
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
              }}
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
  );
};
