import React, { useState, useEffect, useCallback } from 'react';
import { useApp, ProjectMember, ProjectRole, WorkspaceMember } from '../context/AppContext';
import {
  Shield,
  UserCheck,
  UserPlus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Eye,
  MessageSquare,
  Wrench,
  Crown,
} from 'lucide-react';
import './ProjectMembersPanel.css';

interface ProjectMembersPanelProps {
  projectId: string;
  projectName: string;
  workspaceMembers: WorkspaceMember[];
}

export const ProjectMembersPanel: React.FC<ProjectMembersPanelProps> = ({
  projectId,
  projectName,
  workspaceMembers,
}) => {
  const { getProjectMembers, assignProjectRole, removeProjectRole } = useApp();

  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Formulaire d'ajout / mise à jour
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('CONTRIBUTOR');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getProjectMembers(projectId);
      setMembers(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les membres du projet.');
    } finally {
      setLoading(false);
    }
  }, [projectId, getProjectMembers]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !projectId) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await assignProjectRole(projectId, selectedUserId, selectedRole);
      setSuccess('Rôle attribué avec succès.');
      setSelectedUserId('');
      await loadMembers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'attribution du rôle.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveMember = async (targetUserId: string, userName?: string) => {
    if (
      !window.confirm(
        `Confirmez-vous le retrait de ${userName || 'cet utilisateur'} du projet "${projectName}" ?`,
      )
    ) {
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      await removeProjectRole(projectId, targetUserId);
      setSuccess('Membre retiré du projet.');
      await loadMembers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors du retrait du membre.');
    }
  };

  const getRoleBadge = (role: ProjectRole) => {
    switch (role) {
      case 'MANAGER':
        return (
          <span className="project-role-badge project-role-badge--manager">
            <Crown size={12} /> Responsable
          </span>
        );
      case 'CONTRIBUTOR':
        return (
          <span className="project-role-badge project-role-badge--contributor">
            <Wrench size={12} /> Contributeur
          </span>
        );
      case 'COMMENTER':
        return (
          <span className="project-role-badge project-role-badge--commenter">
            <MessageSquare size={12} /> Commentateur
          </span>
        );
      case 'CLIENT':
        return (
          <span className="project-role-badge project-role-badge--client">
            <Eye size={12} /> Client (Lecture)
          </span>
        );
    }
  };

  return (
    <div className="project-members-panel">
      <div className="panel-header-section">
        <div className="panel-title-group">
          <Shield className="panel-title-icon" size={22} />
          <div>
            <h3 className="panel-main-title">Gouvernance & Rôles : {projectName}</h3>
            <p className="panel-subtitle">
              Contrôlez les accès et permissions spécifiques à ce projet pour chaque collaborateur.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="panel-alert panel-alert--error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {success && (
        <div className="panel-alert panel-alert--success" role="status">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* Formulaire d'assignation rapide */}
      <form onSubmit={handleAssignRole} className="assign-role-card">
        <div className="assign-form-row">
          <div className="assign-field">
            <label className="assign-label" htmlFor="member-select">
              <UserPlus size={14} /> Collaborateur du workspace
            </label>
            <select
              id="member-select"
              className="assign-select"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              required
            >
              <option value="">Sélectionner un membre...</option>
              {workspaceMembers.map((wm) => {
                const isAlready = members.some((m) => m.userId === wm.user.id);
                return (
                  <option key={wm.user.id} value={wm.user.id}>
                    {wm.user.name || wm.user.email} ({wm.role})
                    {isAlready ? ' — Déjà membre (Modifier)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="assign-field">
            <label className="assign-label" htmlFor="role-select">
              <Shield size={14} /> Rôle projet
            </label>
            <select
              id="role-select"
              className="assign-select"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as ProjectRole)}
            >
              <option value="MANAGER">MANAGER (Contrôle total du projet)</option>
              <option value="CONTRIBUTOR">CONTRIBUTOR (Édition des tâches & jalons)</option>
              <option value="COMMENTER">COMMENTER (Lecture + Commentaires)</option>
              <option value="CLIENT">CLIENT (Lecture seule épurée)</option>
            </select>
          </div>

          <button
            type="submit"
            className="assign-submit-btn"
            disabled={isSubmitting || !selectedUserId}
          >
            {isSubmitting ? 'Enregistrement...' : 'Assigner / Mettre à jour'}
          </button>
        </div>
      </form>

      {/* Liste des membres du projet */}
      <div className="members-table-container">
        <div className="members-table-header">
          <h4 className="members-table-title">
            <UserCheck size={16} /> Membres assignés ({members.length})
          </h4>
        </div>

        {loading ? (
          <div className="members-loading">Chargement des membres...</div>
        ) : members.length === 0 ? (
          <div className="members-empty">
            Aucun membre explicitement assigné à ce projet. Par défaut, seuls les administrateurs du
            workspace y accèdent.
          </div>
        ) : (
          <div className="members-grid">
            {members.map((member) => (
              <div key={member.id} className="member-card">
                <div className="member-card-avatar">
                  {(member.user.name || member.user.email).slice(0, 2).toUpperCase()}
                </div>
                <div className="member-card-info">
                  <span className="member-card-name">{member.user.name || member.user.email}</span>
                  <span className="member-card-email">{member.user.email}</span>
                  <div className="member-card-badges">{getRoleBadge(member.role)}</div>
                </div>
                <button
                  type="button"
                  className="member-card-delete-btn"
                  title="Retirer du projet"
                  onClick={() => handleRemoveMember(member.userId, member.user.name)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Matrice informative des permissions */}
      <div className="permissions-matrix-card">
        <h4 className="matrix-title">Matrice des Permissions par Rôle Projet</h4>
        <div className="matrix-table-wrapper">
          <table className="matrix-table">
            <thead>
              <tr>
                <th>Capacité</th>
                <th>MANAGER</th>
                <th>CONTRIBUTOR</th>
                <th>COMMENTER</th>
                <th>CLIENT</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Gestion du projet & assignation des rôles</td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-cross">✕</span>
                </td>
                <td>
                  <span className="matrix-cross">✕</span>
                </td>
                <td>
                  <span className="matrix-cross">✕</span>
                </td>
              </tr>
              <tr>
                <td>Création / Édition / Suppression de tâches</td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-cross">✕</span>
                </td>
                <td>
                  <span className="matrix-cross">✕</span>
                </td>
              </tr>
              <tr>
                <td>Création de TimeBlocks & Dépendances Gantt</td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-cross">✕</span>
                </td>
                <td>
                  <span className="matrix-cross">✕</span>
                </td>
              </tr>
              <tr>
                <td>Ajout de commentaires & retours</td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-cross">✕</span>
                </td>
              </tr>
              <tr>
                <td>Consultation des tâches et avancement</td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
                <td>
                  <span className="matrix-check">✓</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
