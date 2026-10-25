import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Boxes,
  CheckCircle2,
  Database,
  ListTodo,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import './AdminConsole.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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
  };
}

interface ActivityEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actor: { id: string; name: string | null; email: string };
}

interface ActivityPage {
  entries: ActivityEntry[];
  total: number;
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
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [activity, setActivity] = useState<ActivityPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user?.token) {
      setError("La session d'administration est absente. Reconnectez-vous.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      const responses = await Promise.all([
        fetch(`${API_URL}/admin/overview`, { headers }),
        fetch(`${API_URL}/admin/health`, { headers }),
        fetch(`${API_URL}/admin/activity?page=1&pageSize=20`, { headers }),
      ]);
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) {
        if (failedResponse.status === 403) {
          throw new Error("Votre compte n'a pas accès à l'administration de la plateforme.");
        }
        throw new Error(`La plateforme a refusé la requête (${failedResponse.status}).`);
      }

      const [nextOverview, nextHealth, nextActivity] = await Promise.all(
        responses.map((response) => response.json()),
      );
      setOverview(nextOverview as Overview);
      setHealth(nextHealth as Health);
      setActivity(nextActivity as ActivityPage);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les données d'administration.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [user?.token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      <header className="admin-console__heading">
        <div>
          <p className="admin-console__eyebrow">PLANNER PRO / CONTRÔLE PLATEFORME</p>
          <h1>État de la plateforme</h1>
          <p className="admin-console__intro">
            Vue opérateur en lecture seule. Les données affichées sont agrégées et les actions
            sensibles restent désactivées.
          </p>
        </div>
        <button
          className="admin-console__refresh"
          type="button"
          onClick={() => void refresh()}
          disabled={isLoading}
        >
          <RefreshCw size={16} className={isLoading ? 'admin-console__spin' : ''} />
          Actualiser
        </button>
      </header>

      {error && (
        <div className="admin-console__error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="admin-console__section" aria-labelledby="admin-totals-title">
        <div className="admin-console__section-heading">
          <h2 id="admin-totals-title">Empreinte de la plateforme</h2>
          <span>{overview ? `Mesure ${formatDate(overview.generatedAt)} UTC` : 'En attente'}</span>
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
                  {healthy ? <CheckCircle2 size={15} /> : value ? <AlertTriangle size={15} /> : '—'}
                  {healthy ? 'Opérationnel' : value ? 'Indisponible' : 'En attente'}
                </strong>
              </div>
            );
          })}
        </div>
        {health?.status === 'degraded' && (
          <p className="admin-console__health-note" role="status">
            Une dépendance ne répond pas. Les détails techniques sont conservés dans les journaux
            du serveur.
          </p>
        )}
      </section>

      <section className="admin-console__section" aria-labelledby="admin-activity-title">
        <div className="admin-console__section-heading">
          <h2 id="admin-activity-title">Journal d’administration</h2>
          <span>{activity ? `${activity.total} événement(s)` : 'En attente'}</span>
        </div>
        {activity?.entries.length ? (
          <div className="admin-console__table-wrap">
            <table className="admin-console__table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Compte opérateur</th>
                  <th scope="col">Cible</th>
                  <th scope="col">Date (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {activity.entries.map((entry) => (
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
              {activity
                ? 'Aucune action administrative enregistrée.'
                : 'Le journal apparaîtra ici dès que les données seront chargées.'}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
