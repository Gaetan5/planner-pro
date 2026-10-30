import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Database,
  History,
  ListTodo,
  LoaderCircle,
  LogIn,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  Building2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import './AdminConsole.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type TabType = 'overview' | 'users' | 'workspaces' | 'activity';

interface Overview {
  generatedAt: string;
  totals: {
    users: number;
    workspaces: number;
    projects: number;
    tasks: number;
    notifications: number;
  };
}

interface Health {
  status: 'healthy' | 'degraded';
  checkedAt: string;
  dependencies: {
    database: 'healthy' | 'unavailable';
    redis: 'healthy' | 'unavailable';
    firestoreSync: {
      state: 'active' | 'disabled';
      pendingEvents: number | null;
      retryingEvents: number | null;
      oldestPendingAt: string | null;
    };
  };
}

interface AdminUserItem {
  id: string;
  email: string;
  name: string | null;
  platformRole: 'SUPER_ADMIN' | 'PLATFORM_ADMIN' | null;
  createdAt: string;
  counts: {
    workspaces: number;
    memberships: number;
    projects: number;
    tasks: number;
  };
}

interface AdminWorkspaceItem {
  id: string;
  name: string;
  createdAt: string;
  deletedAt: string | null;
  owner: {
    id: string;
    name: string | null;
    email: string;
  };
  counts: {
    members: number;
    projects: number;
    teams: number;
  };
}

interface ActivityEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string | null; email: string };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function AdminConsole() {
  const { user } = useApp();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Overview & Health
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  // Users Tab
  const [usersList, setUsersList] = useState<AdminUserItem[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState('');

  // Workspaces Tab
  const [workspacesList, setWorkspacesList] = useState<AdminWorkspaceItem[]>([]);
  const [workspacesTotal, setWorkspacesTotal] = useState(0);
  const [workspacesPage, setWorkspacesPage] = useState(1);
  const [workspacesSearch, setWorkspacesSearch] = useState('');

  // Activity Tab
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [activitySearch, setActivitySearch] = useState('');

  // Feedback states
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  // Impersonation masquée tant que le serveur ne l'a pas activée (S18, étape 0)
  const [impersonationEnabled, setImpersonationEnabled] = useState<boolean | null>(null);

  // Check if we are currently impersonating someone
  const backupSession = sessionStorage.getItem('planner_admin_original_session');

  const getHeaders = useCallback(() => {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user?.token || ''}`,
    };
  }, [user?.token]);

  // Load Overview & Health
  const loadOverviewAndHealth = useCallback(async () => {
    if (!user?.token) return;
    try {
      const [ovRes, hlRes] = await Promise.all([
        fetch(`${API_URL}/admin/overview`, { headers: getHeaders() }),
        fetch(`${API_URL}/admin/health`, { headers: getHeaders() }),
      ]);
      if (ovRes.status === 403 || hlRes.status === 403) {
        setError("Votre compte n'a pas accès à l'administration de la plateforme.");
        return;
      }
      if (ovRes.ok && hlRes.ok) {
        setOverview(await ovRes.json());
        setHealth(await hlRes.json());
      }
    } catch (e) {
      console.error(e);
    }
  }, [user?.token, getHeaders]);

  // Load Users
  const loadUsers = useCallback(async () => {
    if (!user?.token) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: usersPage.toString(),
        pageSize: '15',
        ...(usersSearch ? { search: usersSearch } : {}),
      });
      const res = await fetch(`${API_URL}/admin/users?${params}`, {
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error(`Erreur récupération utilisateurs (${res.status})`);
      const data = await res.json();
      setUsersList(data.entries);
      setUsersTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.token, usersPage, usersSearch, getHeaders]);

  // Load Workspaces
  const loadWorkspaces = useCallback(async () => {
    if (!user?.token) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: workspacesPage.toString(),
        pageSize: '15',
        ...(workspacesSearch ? { search: workspacesSearch } : {}),
      });
      const res = await fetch(`${API_URL}/admin/workspaces?${params}`, {
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error(`Erreur récupération espaces (${res.status})`);
      const data = await res.json();
      setWorkspacesList(data.entries);
      setWorkspacesTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.token, workspacesPage, workspacesSearch, getHeaders]);

  // Load Activity
  const loadActivity = useCallback(async () => {
    if (!user?.token) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: activityPage.toString(),
        pageSize: '20',
        ...(activitySearch ? { search: activitySearch } : {}),
      });
      const res = await fetch(`${API_URL}/admin/activity?${params}`, {
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error(`Erreur récupération journal (${res.status})`);
      const data = await res.json();
      setActivityEntries(data.entries);
      setActivityTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.token, activityPage, activitySearch, getHeaders]);

  // Drapeau d'impersonation, chargé à la première ouverture de l'onglet Utilisateurs
  useEffect(() => {
    if (activeTab !== 'users' || impersonationEnabled !== null) return;
    fetch(`${API_URL}/features`)
      .then((res) => (res.ok ? res.json() : { impersonation: false }))
      .then((flags: { impersonation?: boolean }) =>
        setImpersonationEnabled(flags.impersonation === true),
      )
      .catch(() => setImpersonationEnabled(false));
  }, [activeTab, impersonationEnabled]);

  // Handle Tab Change
  useEffect(() => {
    if (activeTab === 'overview') {
      setIsLoading(true);
      void loadOverviewAndHealth().finally(() => setIsLoading(false));
    } else if (activeTab === 'users') {
      void loadUsers();
    } else if (activeTab === 'workspaces') {
      void loadWorkspaces();
    } else if (activeTab === 'activity') {
      void loadActivity();
    }
  }, [activeTab, loadOverviewAndHealth, loadUsers, loadWorkspaces, loadActivity]);

  // Action: Change User Role
  const handleRoleChange = async (targetUserId: string, newRole: string) => {
    setActionLoadingId(targetUserId);
    setError(null);
    try {
      const rolePayload = newRole === 'NONE' ? null : newRole;
      const res = await fetch(`${API_URL}/admin/users/${targetUserId}/role`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ role: rolePayload }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Impossible de mettre à jour le rôle.');
      }
      setSuccessMessage('Rôle mis à jour avec succès.');
      void loadUsers();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la modification du rôle.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Revoke Sessions
  const handleRevokeSessions = async (targetUserId: string, email: string) => {
    if (!window.confirm(`Révoquer toutes les sessions de ${email} ?`)) return;
    setActionLoadingId(targetUserId);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/users/${targetUserId}/revoke-sessions`, {
        method: 'POST',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('Échec de la révocation des sessions.');
      const data = await res.json();
      setSuccessMessage(data.message || 'Sessions révoquées avec succès.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la révocation.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Impersonate
  const handleImpersonate = async (targetUserId: string, email: string) => {
    if (!window.confirm(`Se connecter immédiatement sous l'identité de ${email} ?`)) return;
    setActionLoadingId(targetUserId);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/users/${targetUserId}/impersonate`, {
        method: 'POST',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error("Échec de l'impersonation.");
      const data = await res.json();

      // Sauvegarder la session admin actuelle
      const currentSession = localStorage.getItem('planner_user');
      if (currentSession) {
        sessionStorage.setItem('planner_admin_original_session', currentSession);
      }

      // Appliquer la nouvelle session et recharger
      const newUserSession = {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        token: data.accessToken,
        platformRole: data.user.platformRole ?? null,
      };
      localStorage.setItem('planner_user', JSON.stringify(newUserSession));
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'impersonation.");
      setActionLoadingId(null);
    }
  };

  // Action: Restore Admin Session
  const handleRestoreAdminSession = () => {
    if (!backupSession) return;
    localStorage.setItem('planner_user', backupSession);
    sessionStorage.removeItem('planner_admin_original_session');
    window.location.reload();
  };

  const totalCards = overview
    ? [
        { label: 'Comptes', value: overview.totals.users, icon: Users },
        { label: 'Espaces', value: overview.totals.workspaces, icon: Boxes },
        { label: 'Projets', value: overview.totals.projects, icon: Activity },
        { label: 'Tâches', value: overview.totals.tasks, icon: ListTodo },
        { label: 'Notifications', value: overview.totals.notifications, icon: Bell },
      ]
    : [];

  return (
    <main className="admin-console" aria-busy={isLoading}>
      {/* Header */}
      <header className="admin-console__heading">
        <div>
          <p className="admin-console__eyebrow">PLANNER PRO / CONTRÔLE PLATEFORME</p>
          <h1>Administration Système</h1>
          <p className="admin-console__intro">
            Console d'exploitation et de gouvernance de la plateforme. Gestion des utilisateurs,
            espaces, intégrité système et audit opérationnel.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {backupSession && (
            <button
              className="admin-btn admin-btn--primary"
              type="button"
              onClick={handleRestoreAdminSession}
            >
              <UserCheck size={16} />
              Quitter l'impersonation
            </button>
          )}
          <button
            className="admin-console__refresh"
            type="button"
            onClick={() => {
              if (activeTab === 'overview') void loadOverviewAndHealth();
              else if (activeTab === 'users') void loadUsers();
              else if (activeTab === 'workspaces') void loadWorkspaces();
              else if (activeTab === 'activity') void loadActivity();
            }}
            disabled={isLoading}
          >
            <RefreshCw size={16} className={isLoading ? 'admin-console__spin' : ''} />
            Actualiser
          </button>
        </div>
      </header>

      {/* Tabs navigation */}
      <nav className="admin-console__tabs" aria-label="Sections d'administration">
        <button
          className={`admin-console__tab ${activeTab === 'overview' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setActiveTab('overview')}
        >
          <Activity size={16} />
          Vue d'ensemble & Santé
        </button>
        <button
          className={`admin-console__tab ${activeTab === 'users' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setActiveTab('users')}
        >
          <Users size={16} />
          Utilisateurs ({usersTotal || overview?.totals.users || '…'})
        </button>
        <button
          className={`admin-console__tab ${activeTab === 'workspaces' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setActiveTab('workspaces')}
        >
          <Building2 size={16} />
          Espaces de travail ({workspacesTotal || overview?.totals.workspaces || '…'})
        </button>
        <button
          className={`admin-console__tab ${activeTab === 'activity' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setActiveTab('activity')}
        >
          <History size={16} />
          Journal d'Audit
        </button>
      </nav>

      {/* Error & Success Feedback */}
      {error && (
        <div className="admin-console__error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="admin-console__success" role="status">
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={18} />
            {successMessage}
          </span>
          <button
            className="admin-btn"
            style={{ padding: '2px 8px' }}
            type="button"
            onClick={() => setSuccessMessage(null)}
          >
            Fermer
          </button>
        </div>
      )}

      {/* TAB 1: OVERVIEW & HEALTH */}
      {activeTab === 'overview' && (
        <>
          <section className="admin-console__section" aria-labelledby="admin-totals-title">
            <div className="admin-console__section-heading">
              <h2 id="admin-totals-title">Empreinte de la plateforme</h2>
              <span>
                {overview ? `Mesure ${formatDate(overview.generatedAt)} UTC` : 'En attente'}
              </span>
            </div>
            <div className="admin-console__totals">
              {totalCards.map(({ label, value, icon: Icon }) => (
                <article className="admin-console__total" key={label}>
                  <div className="admin-console__total-label">
                    <Icon size={15} aria-hidden="true" />
                    <span>{label}</span>
                  </div>
                  <strong>{value.toLocaleString('fr-FR')}</strong>
                </article>
              ))}
              {!overview && isLoading && (
                <div className="admin-console__loading">
                  <LoaderCircle size={18} className="admin-console__spin" />
                  Lecture des indicateurs…
                </div>
              )}
            </div>
          </section>

          <section className="admin-console__section" aria-labelledby="admin-health-title">
            <div className="admin-console__section-heading">
              <h2 id="admin-health-title">Dépendances de production</h2>
              {health && <span>Vérifié {formatDate(health.checkedAt)} UTC</span>}
            </div>
            <div className="admin-console__health">
              {[
                { label: 'Base de données', value: health?.dependencies.database, icon: Database },
                { label: 'Cache Redis', value: health?.dependencies.redis, icon: Boxes },
              ].map(({ label, value, icon: Icon }) => {
                const healthy = value === 'healthy';
                return (
                  <div
                    className={`admin-console__dependency ${value ? `is-${value}` : 'is-pending'}`}
                    key={label}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                    <strong>
                      {healthy ? (
                        <CheckCircle2 size={15} />
                      ) : value ? (
                        <AlertTriangle size={15} />
                      ) : (
                        '—'
                      )}
                      {healthy ? 'Opérationnel' : value ? 'Indisponible' : 'En attente'}
                    </strong>
                  </div>
                );
              })}
            </div>
            <div className="admin-console__sync-status">
              <Cloud size={18} aria-hidden="true" />
              <span>Miroir Firestore</span>
              {health?.dependencies.firestoreSync.state === 'active' ? (
                <strong>
                  Actif · {health.dependencies.firestoreSync.pendingEvents} en attente ·{' '}
                  {health.dependencies.firestoreSync.retryingEvents} en reprise
                </strong>
              ) : (
                <strong>Désactivé</strong>
              )}
              {health?.dependencies.firestoreSync.oldestPendingAt && (
                <small>
                  Événement en attente depuis{' '}
                  {formatDate(health.dependencies.firestoreSync.oldestPendingAt)} UTC
                </small>
              )}
            </div>
            {health?.status === 'degraded' && (
              <p className="admin-console__health-note" role="status">
                Une dépendance ne répond pas. Les détails techniques sont conservés dans les
                journaux du serveur.
              </p>
            )}
          </section>
        </>
      )}

      {/* TAB 2: USERS MANAGEMENT */}
      {activeTab === 'users' && (
        <section className="admin-console__section" aria-labelledby="admin-users-title">
          <div className="admin-console__section-heading">
            <h2 id="admin-users-title">Gestion des Comptes & Droits</h2>
            <span>{usersTotal} compte(s) au total</span>
          </div>

          {/* Toolbar */}
          <div className="admin-console__toolbar">
            <div className="admin-console__search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Rechercher par nom ou email…"
                value={usersSearch}
                onChange={(e) => {
                  setUsersSearch(e.target.value);
                  setUsersPage(1);
                }}
              />
            </div>
            <div className="admin-console__pagination">
              <span>
                Page {usersPage} sur {Math.max(1, Math.ceil(usersTotal / 15))}
              </span>
              <button
                type="button"
                disabled={usersPage <= 1 || isLoading}
                onClick={() => setUsersPage((p) => p - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                disabled={usersPage * 15 >= usersTotal || isLoading}
                onClick={() => setUsersPage((p) => p + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Users Table */}
          <div className="admin-console__table-wrap">
            <table className="admin-console__table">
              <thead>
                <tr>
                  <th scope="col">Utilisateur</th>
                  <th scope="col">Rôle Plateforme</th>
                  <th scope="col">Métriques</th>
                  <th scope="col">Date Inscription</th>
                  <th scope="col">Actions Opérateur</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((item) => {
                  const isBusy = actionLoadingId === item.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name || 'Sans nom'}</strong>
                        <small className="admin-console__actor-email">{item.email}</small>
                        <small style={{ opacity: 0.6 }}>ID: {item.id}</small>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div>
                            {item.platformRole === 'SUPER_ADMIN' && (
                              <span className="admin-pill admin-pill--super">Super Admin</span>
                            )}
                            {item.platformRole === 'PLATFORM_ADMIN' && (
                              <span className="admin-pill admin-pill--admin">Admin Plateforme</span>
                            )}
                            {!item.platformRole && (
                              <span className="admin-pill admin-pill--user">Standard</span>
                            )}
                          </div>
                          <select
                            className="admin-role-select"
                            value={item.platformRole || 'NONE'}
                            disabled={isBusy}
                            onChange={(e) => void handleRoleChange(item.id, e.target.value)}
                          >
                            <option value="NONE">Utilisateur Standard</option>
                            <option value="PLATFORM_ADMIN">Admin Plateforme</option>
                            <option value="SUPER_ADMIN">Super Admin</option>
                          </select>
                        </div>
                      </td>
                      <td>
                        <div className="admin-metric-pills">
                          <span className="admin-metric-pill" title="Workspaces possédés">
                            Espaces: <strong>{item.counts.workspaces}</strong>
                          </span>
                          <span className="admin-metric-pill" title="Projets créés">
                            Projets: <strong>{item.counts.projects}</strong>
                          </span>
                          <span className="admin-metric-pill" title="Tâches assignées/créées">
                            Tâches: <strong>{item.counts.tasks}</strong>
                          </span>
                        </div>
                      </td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            className="admin-btn admin-btn--danger"
                            type="button"
                            title="Révoquer tous les tokens et forcer la déconnexion"
                            disabled={isBusy}
                            onClick={() => void handleRevokeSessions(item.id, item.email)}
                          >
                            <ShieldAlert size={14} />
                            Déconnecter
                          </button>
                          {impersonationEnabled && (
                            <button
                              className="admin-btn"
                              type="button"
                              title="Se connecter sous l'identité de cet utilisateur pour diagnostiquer un incident"
                              disabled={isBusy || item.id === user?.id}
                              onClick={() => void handleImpersonate(item.id, item.email)}
                            >
                              <LogIn size={14} />
                              Impersonate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: WORKSPACES MANAGEMENT */}
      {activeTab === 'workspaces' && (
        <section className="admin-console__section" aria-labelledby="admin-workspaces-title">
          <div className="admin-console__section-heading">
            <h2 id="admin-workspaces-title">Espaces de Travail</h2>
            <span>{workspacesTotal} espace(s) recensé(s)</span>
          </div>

          <div className="admin-console__toolbar">
            <div className="admin-console__search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Rechercher un espace de travail…"
                value={workspacesSearch}
                onChange={(e) => {
                  setWorkspacesSearch(e.target.value);
                  setWorkspacesPage(1);
                }}
              />
            </div>
            <div className="admin-console__pagination">
              <span>
                Page {workspacesPage} sur {Math.max(1, Math.ceil(workspacesTotal / 15))}
              </span>
              <button
                type="button"
                disabled={workspacesPage <= 1 || isLoading}
                onClick={() => setWorkspacesPage((p) => p - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                disabled={workspacesPage * 15 >= workspacesTotal || isLoading}
                onClick={() => setWorkspacesPage((p) => p + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="admin-console__table-wrap">
            <table className="admin-console__table">
              <thead>
                <tr>
                  <th scope="col">Espace de Travail</th>
                  <th scope="col">Propriétaire</th>
                  <th scope="col">Volumétrie</th>
                  <th scope="col">Date Création</th>
                  <th scope="col">Statut</th>
                </tr>
              </thead>
              <tbody>
                {workspacesList.map((ws) => (
                  <tr key={ws.id}>
                    <td>
                      <strong>{ws.name}</strong>
                      <small style={{ opacity: 0.6 }}>ID: {ws.id}</small>
                    </td>
                    <td>
                      <span>{ws.owner.name || ws.owner.email}</span>
                      <small className="admin-console__actor-email">{ws.owner.email}</small>
                    </td>
                    <td>
                      <div className="admin-metric-pills">
                        <span className="admin-metric-pill">
                          Membres: <strong>{ws.counts.members}</strong>
                        </span>
                        <span className="admin-metric-pill">
                          Projets: <strong>{ws.counts.projects}</strong>
                        </span>
                        <span className="admin-metric-pill">
                          Équipes: <strong>{ws.counts.teams}</strong>
                        </span>
                      </div>
                    </td>
                    <td>{formatDate(ws.createdAt)}</td>
                    <td>
                      {ws.deletedAt ? (
                        <span className="admin-pill" style={{ color: 'var(--admin-alert)' }}>
                          Archivé
                        </span>
                      ) : (
                        <span className="admin-pill" style={{ color: 'var(--admin-teal)' }}>
                          Actif
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 4: AUDIT ACTIVITY LOG */}
      {activeTab === 'activity' && (
        <section className="admin-console__section" aria-labelledby="admin-activity-title">
          <div className="admin-console__section-heading">
            <h2 id="admin-activity-title">Journal d’administration & Sécurité</h2>
            <span>{activityTotal} événement(s) enregistré(s)</span>
          </div>

          <div className="admin-console__toolbar">
            <div className="admin-console__search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Filtrer par action, opérateur ou cible…"
                value={activitySearch}
                onChange={(e) => {
                  setActivitySearch(e.target.value);
                  setActivityPage(1);
                }}
              />
            </div>
            <div className="admin-console__pagination">
              <span>
                Page {activityPage} sur {Math.max(1, Math.ceil(activityTotal / 20))}
              </span>
              <button
                type="button"
                disabled={activityPage <= 1 || isLoading}
                onClick={() => setActivityPage((p) => p - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                disabled={activityPage * 20 >= activityTotal || isLoading}
                onClick={() => setActivityPage((p) => p + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {activityEntries.length ? (
            <div className="admin-console__table-wrap">
              <table className="admin-console__table">
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Opérateur</th>
                    <th scope="col">Cible</th>
                    <th scope="col">Détails / Métadonnées</th>
                    <th scope="col">Date (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {activityEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <code>{entry.action}</code>
                      </td>
                      <td>
                        <span>{entry.actor.name || entry.actor.email}</span>
                        {entry.actor.name && (
                          <small className="admin-console__actor-email">{entry.actor.email}</small>
                        )}
                      </td>
                      <td>
                        {entry.targetType}
                        {entry.targetId && <small>{entry.targetId}</small>}
                      </td>
                      <td>
                        {entry.metadata ? (
                          <div
                            className="admin-metadata-preview"
                            title={JSON.stringify(entry.metadata, null, 2)}
                          >
                            {JSON.stringify(entry.metadata)}
                          </div>
                        ) : (
                          <span style={{ opacity: 0.4 }}>—</span>
                        )}
                      </td>
                      <td>{formatDate(entry.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-console__empty">
              <ShieldCheck size={20} />
              <p>
                {activityTotal === 0
                  ? 'Aucune action administrative enregistrée.'
                  : 'Aucun événement ne correspond à ce filtre.'}
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
