import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import './IntegrationsPanel.css';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Integration {
  id: string;
  type: 'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK';
  name: string;
  url: string | null;
  calendarId: string | null;
  active: boolean;
  createdAt: string;
  status?: 'CONNECTED' | 'EXPIRED' | 'DEMO' | 'DISABLED';
}

interface CalendarConflict {
  id: string;
  userId: string;
  userName: string;
  localTimeBlockId: string;
  localTaskTitle: string;
  externalEventTitle: string;
  startTime: string;
  endTime: string;
  message: string;
}

interface IntegrationsPanelProps {
  workspaceId: string;
}

export const IntegrationsPanel: React.FC<IntegrationsPanelProps> = ({ workspaceId }) => {
  const {
    listIntegrations,
    createIntegration,
    toggleIntegration,
    deleteIntegration,
    exportToCalendar,
    getCalendarConflicts,
    user,
  } = useApp();

  const getHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: user?.token ? `Bearer ${user.token}` : '',
  });

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [conflicts, setConflicts] = useState<CalendarConflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [type, setType] = useState<'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK'>('SLACK');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [scheduling, setScheduling] = useState(false);

  const handleAutoSchedule = async () => {
    setScheduling(true);
    try {
      const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/auto-schedule`, {
        method: 'POST',
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        alert(
          `Planification automatique réussie ! ${data.scheduledCount} créneaux horaires alloués.`,
        );
        loadData();
      } else {
        alert('Erreur lors de la planification automatique.');
      }
    } catch (err) {
      console.error(err);
      alert('Erreur réseau.');
    } finally {
      setScheduling(false);
    }
  };

  const loadData = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const list = (await listIntegrations(workspaceId)) as Integration[];
      setIntegrations(list);
      const confs = (await getCalendarConflicts(workspaceId)) as CalendarConflict[];
      setConflicts(confs);
    } catch (err: unknown) {
      setError((err as Error).message || 'Erreur lors du chargement des intégrations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [workspaceId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setError(null);
    try {
      await createIntegration(
        workspaceId,
        type,
        name,
        url ? url : undefined,
        type === 'GOOGLE_CALENDAR' || type === 'OUTLOOK' ? calendarId : undefined,
      );
      // Reset form
      setName('');
      setUrl('');
      setCalendarId('');
      // Reload
      await loadData();
    } catch (err: unknown) {
      setError((err as Error).message || "Erreur lors de la création de l'intégration.");
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await toggleIntegration(id);
      await loadData();
    } catch (err: unknown) {
      setError((err as Error).message || 'Erreur lors du toggle.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Voulez-vous vraiment supprimer cette intégration ?')) return;
    try {
      await deleteIntegration(id);
      await loadData();
    } catch (err: unknown) {
      setError((err as Error).message || 'Erreur lors de la suppression.');
    }
  };

  const handleExport = async (id: string) => {
    try {
      const res = (await exportToCalendar(workspaceId, id)) as { exportedCount: number };
      alert(`Export réussi ! ${res.exportedCount} créneaux horaires locaux synchronisés.`);
    } catch (err: unknown) {
      setError((err as Error).message || "Erreur lors de l'exportation.");
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'SLACK':
        return '💬';
      case 'TEAMS':
        return '👥';
      case 'GOOGLE_CALENDAR':
        return '📅';
      case 'OUTLOOK':
        return '📧';
      default:
        return '🔌';
    }
  };

  return (
    <div className="integrations-container">
      <div
        className="integrations-header-section"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h2>Synchronisation Réelle</h2>
          <p>
            Connectez vos messageries d'équipe et vos agendas externes pour centraliser et
            coordonner la planification.
          </p>
        </div>
        <button
          onClick={handleAutoSchedule}
          disabled={scheduling}
          className="btn-primary-gradient auto-schedule-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: '0 0 15px rgba(139, 92, 246, 0.35)',
            alignSelf: 'center',
            padding: '0.75rem 1.25rem',
            fontSize: '0.85rem',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <span>{scheduling ? 'Planification...' : 'Planifier Automatiquement'}</span>
          <span>⚡</span>
        </button>
      </div>

      {error && (
        <div
          className="error-message"
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#f87171',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid rgba(239, 68, 68, 0.2)',
          }}
        >
          {error}
        </div>
      )}

      {/* Liste des intégrations */}
      <div className="integrations-grid">
        {integrations.map((integration) => (
          <div
            key={integration.id}
            className={`integration-card ${integration.type.toLowerCase()}`}
          >
            <div className="integration-card-top">
              <div className="integration-icon-title">
                <div className="integration-icon-wrapper">{getIcon(integration.type)}</div>
                <div>
                  <h3>{integration.name}</h3>
                  <div className="integration-status-wrapper">
                    <span className="integration-type-badge">{integration.type}</span>
                    {integration.active ? (
                      integration.status === 'CONNECTED' ? (
                        <span className="integration-status-badge connected">
                          <span className="pulse-dot"></span>
                          Connecté
                        </span>
                      ) : integration.status === 'EXPIRED' ? (
                        <span className="integration-status-badge expired">
                          <span className="pulse-dot"></span>
                          Expiré
                        </span>
                      ) : integration.status === 'DEMO' ? (
                        <span className="integration-status-badge demo">
                          <span className="pulse-dot"></span>
                          Démonstration
                        </span>
                      ) : (
                        <span className="integration-status-badge connected">
                          <span className="pulse-dot"></span>
                          Actif
                        </span>
                      )
                    ) : (
                      <span className="integration-status-badge disabled">Désactivé</span>
                    )}
                  </div>
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={integration.active}
                  onChange={() => handleToggle(integration.id)}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className="integration-card-body">
              {integration.url && (
                <div>
                  <strong>URL Webhook :</strong>
                  <div className="integration-url-masked">{integration.url}</div>
                </div>
              )}
              {integration.calendarId && (
                <div>
                  <strong>ID Calendrier :</strong>
                  <div className="integration-url-masked">{integration.calendarId}</div>
                </div>
              )}
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                Connecté le : {new Date(integration.createdAt).toLocaleDateString('fr-FR')}
              </div>
            </div>

            <div className="integration-card-actions">
              {(integration.type === 'GOOGLE_CALENDAR' || integration.type === 'OUTLOOK') && (
                <button
                  className="btn-secondary-glass"
                  onClick={() => handleExport(integration.id)}
                  disabled={!integration.active}
                >
                  🚀 Exporter créneaux
                </button>
              )}
              <button
                className="btn-icon-danger"
                onClick={() => handleDelete(integration.id)}
                title="Supprimer l'intégration"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}

        {integrations.length === 0 && !loading && (
          <div
            style={{
              gridColumn: '1/-1',
              textAlign: 'center',
              padding: '2rem',
              background: 'rgba(255,255,255,0.02)',
              borderRadius: '12px',
              border: '1px dashed rgba(255,255,255,0.1)',
            }}
          >
            Aucune intégration connectée pour cet espace de travail.
          </div>
        )}
      </div>

      {/* Formulaire d'ajout */}
      <div className="integration-form-section">
        <h3>➕ Ajouter une Intégration</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Service</label>
              <select
                value={type}
                onChange={(e) =>
                  setType(e.target.value as 'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK')
                }
              >
                <option value="SLACK">Slack (Webhook)</option>
                <option value="TEAMS">Microsoft Teams (Webhook)</option>
                <option value="GOOGLE_CALENDAR">Google Calendar</option>
                <option value="OUTLOOK">Outlook Calendar</option>
              </select>
            </div>

            <div className="form-group">
              <label>Nom de l'Intégration</label>
              <input
                type="text"
                placeholder="Ex: Slack Alertes, Mon Agenda Google..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {type === 'SLACK' || type === 'TEAMS' ? (
              <div className="form-group">
                <label>URL du Webhook</label>
                <input
                  type="url"
                  placeholder="https://hooks.slack.com/services/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label>ID / Adresse Email du Calendrier</label>
                  <input
                    type="text"
                    placeholder="Ex: primary ou user@domain.com"
                    value={calendarId}
                    onChange={(e) => setCalendarId(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>URL de flux (ICS / JSON ou Simulateur) — Optionnel</label>
                  <input
                    type="url"
                    placeholder="Ex: http://localhost:3001/projects/mock-calendar?email=alice@test.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <button type="submit" className="btn-primary-gradient">
            Ajouter l'intégration
          </button>
        </form>
      </div>

      {/* Conflits détectés */}
      <div className="conflicts-section">
        <div className="conflicts-header">
          <h3>⚠️ Conflits d'Agendas Externes Détectés</h3>
          <button className="btn-refresh-glass" onClick={loadData}>
            🔄 Actualiser
          </button>
        </div>

        <div className="conflicts-list">
          {conflicts.map((conflict) => (
            <div key={conflict.id} className="conflict-item">
              <div className="conflict-content">
                <span className="conflict-badge">CONFLIT</span>
                <strong>{conflict.userName}</strong> — {conflict.message}
              </div>
            </div>
          ))}

          {conflicts.length === 0 && (
            <div className="no-conflicts">
              ✨ Aucun conflit d'agenda externe détecté dans cet espace de travail !
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
