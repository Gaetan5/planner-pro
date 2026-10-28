import React, { useState, useEffect, useCallback } from 'react';
import { useApp, ProjectAuditLog } from '../context/AppContext';
import {
  History,
  PlusCircle,
  Edit,
  Trash,
  ShieldCheck,
  Clock,
  User,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import './ProjectAuditLogPanel.css';

interface ProjectAuditLogPanelProps {
  projectId: string;
  projectName: string;
}

export const ProjectAuditLogPanel: React.FC<ProjectAuditLogPanelProps> = ({
  projectId,
  projectName,
}) => {
  const { getProjectAuditLogs } = useApp();

  const [logs, setLogs] = useState<ProjectAuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getProjectAuditLogs(projectId, 50);
      setLogs(data);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger le journal d'audit du projet.",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, getProjectAuditLogs]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'TASK_CREATE':
        return (
          <span className="audit-action-badge audit-action-badge--create">
            <PlusCircle size={12} /> Tâche créée
          </span>
        );
      case 'TASK_UPDATE':
        return (
          <span className="audit-action-badge audit-action-badge--update">
            <Edit size={12} /> Tâche modifiée
          </span>
        );
      case 'TASK_DELETE':
        return (
          <span className="audit-action-badge audit-action-badge--delete">
            <Trash size={12} /> Tâche supprimée
          </span>
        );
      case 'PROJECT_ROLE_ASSIGN':
        return (
          <span className="audit-action-badge audit-action-badge--role">
            <ShieldCheck size={12} /> Rôle assigné
          </span>
        );
      case 'PROJECT_ROLE_REMOVE':
        return (
          <span className="audit-action-badge audit-action-badge--delete">
            <ShieldCheck size={12} /> Rôle retiré
          </span>
        );
      case 'PROJECT_UPDATE':
        return (
          <span className="audit-action-badge audit-action-badge--update">
            <Edit size={12} /> Projet modifié
          </span>
        );
      default:
        return <span className="audit-action-badge audit-action-badge--default">{action}</span>;
    }
  };

  const renderPayloadSummary = (changes: Record<string, unknown> | string | null) => {
    if (!changes) return null;
    let parsed = changes;
    if (typeof changes === 'string') {
      try {
        parsed = JSON.parse(changes);
      } catch {
        return <span className="audit-payload-raw">{changes}</span>;
      }
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return <span>{String(parsed)}</span>;
    }

    return (
      <div className="audit-changes-preview">
        {Object.entries(parsed).map(([key, value]) => {
          if (value === undefined || value === null) return null;
          return (
            <span key={key} className="audit-change-chip">
              <strong>{key}</strong>:{' '}
              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="project-audit-panel">
      <div className="audit-header">
        <div className="audit-title-group">
          <History className="audit-title-icon" size={22} />
          <div>
            <h3 className="audit-main-title">Journal d'Audit : {projectName}</h3>
            <p className="audit-subtitle">
              Traçabilité complète et immuable des opérations effectuées sur ce projet.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadLogs}
          disabled={loading}
          className="audit-refresh-btn"
          title="Actualiser les logs"
        >
          <RefreshCw size={15} className={loading ? 'spinning' : ''} />
          <span>Actualiser</span>
        </button>
      </div>

      {error && (
        <div className="audit-alert" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading && logs.length === 0 ? (
        <div className="audit-empty-state">Chargement du journal d'audit...</div>
      ) : logs.length === 0 ? (
        <div className="audit-empty-state">
          Aucun événement consigné pour ce projet pour le moment.
        </div>
      ) : (
        <div className="audit-timeline">
          {logs.map((log) => {
            const date = new Date(log.createdAt);
            const relativeTime = formatDistanceToNow(date, { addSuffix: true, locale: fr });
            const exactTime = format(date, 'dd/MM/yyyy HH:mm:ss');

            return (
              <div key={log.id} className="audit-entry">
                <div className="audit-entry-indicator">
                  <div className="audit-entry-dot" />
                  <div className="audit-entry-line" />
                </div>

                <div className="audit-entry-card">
                  <div className="audit-entry-top">
                    <div className="audit-entry-badges">
                      {getActionBadge(log.action)}
                      <span className="audit-entity-type">{log.entityType}</span>
                    </div>
                    <span className="audit-timestamp" title={exactTime}>
                      <Clock size={12} /> {relativeTime}
                    </span>
                  </div>

                  <div className="audit-entry-actor">
                    <User size={14} />
                    <span>
                      {log.user?.name || log.user?.email || `Utilisateur (${log.userId})`}
                    </span>
                  </div>

                  {log.changes && (
                    <div className="audit-entry-details">{renderPayloadSummary(log.changes)}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
