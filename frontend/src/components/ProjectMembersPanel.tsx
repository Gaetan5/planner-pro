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
  Mail,
  Copy,
  Clock,
  ExternalLink,
} from 'lucide-react';
import './ProjectMembersPanel.css';

interface ProjectInvitation {
  id: string;
  email: string | null;
  role: string;
  projectId?: string | null;
  expiresAt: string;
  invitedBy?: {
    name?: string | null;
    email?: string | null;
  };
}

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
  const {
    getProjectMembers,
    assignProjectRole,
    removeProjectRole,
    createInvitation,
    listInvitations,
    revokeInvitation,
    activeWorkspaceId,
  } = useApp();

  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [projectInvitations, setProjectInvitations] = useState<ProjectInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form mode : 'existing' ou 'external'
  const [addMode, setAddMode] = useState<'existing' | 'external'>('existing');

  // Formulaire membre existant
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('CONTRIBUTOR');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Formulaire invité externe
  const [externalEmail, setExternalEmail] = useState('');
  const [externalRole, setExternalRole] = useState<'CONTRIBUTOR' | 'COMMENTER' | 'CLIENT'>(
    'CONTRIBUTOR',
  );
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const loadMembersAndInvitations = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getProjectMembers(projectId);
      setMembers(data);

      if (activeWorkspaceId) {
        const invs = (await listInvitations(activeWorkspaceId)) as ProjectInvitation[];
        // Filtrer les invitations spécifiques à ce projet
        const filtered = (invs || []).filter((inv) => inv.projectId === projectId);
        setProjectInvitations(filtered);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les données du projet.');
    } finally {
      setLoading(false);
    }
  }, [projectId, activeWorkspaceId, getProjectMembers, listInvitations]);

  useEffect(() => {
    loadMembersAndInvitations();
  }, [loadMembersAndInvitations]);

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
      await loadMembersAndInvitations();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'attribution du rôle.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInviteExternal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId || !projectId) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    setGeneratedInviteLink(null);
    try {
      // Mapper le rôle projet vers le rôle workspace approprié
      const wsRole = externalRole === 'CLIENT' ? 'VIEWER' : 'MEMBER';

      const res = await createInvitation(
        activeWorkspaceId,
        externalEmail.trim() || null,
        wsRole,
        projectId,
        7,
      );

      if (res && res.rawToken) {
        const link = `${window.location.origin}/?token=${res.rawToken}`;
        setGeneratedInviteLink(link);
        setSuccess(
          externalEmail
            ? `Invitation envoyée par email à ${externalEmail} et lien généré.`
            : 'Lien d’invitation pour collaborateur externe généré avec succès.',
        );
      } else {
        setSuccess('Invitation créée avec succès.');
      }

      setExternalEmail('');
      await loadMembersAndInvitations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'envoi de l'invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = () => {
    if (!generatedInviteLink) return;
    navigator.clipboard.writeText(generatedInviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!window.confirm("Confirmez-vous l'annulation de cette invitation ?")) return;
    try {
      await revokeInvitation(invitationId);
      setSuccess('Invitation révoquée.');
      await loadMembersAndInvitations();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Erreur lors de la révocation de l'invitation.",
      );
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
      await loadMembersAndInvitations();
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
            <h3 className="panel-main-title">Gouvernance & Équipe : {projectName}</h3>
            <p className="panel-subtitle">
              Gérez les contributeurs internes et invitez des collaborateurs externes (clients,
              prestataires).
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

      {/* Onglets de mode d'ajout */}
      <div className="add-mode-toggle">
        <button
          type="button"
          onClick={() => {
            setAddMode('existing');
            setGeneratedInviteLink(null);
          }}
          className={`add-mode-btn ${addMode === 'existing' ? 'active' : ''}`}
        >
          <UserPlus size={15} /> Collaborateur du workspace
        </button>
        <button
          type="button"
          onClick={() => {
            setAddMode('external');
            setGeneratedInviteLink(null);
          }}
          className={`add-mode-btn ${addMode === 'external' ? 'active' : ''}`}
        >
          <Mail size={15} /> Inviter un externe (Email / Lien)
        </button>
      </div>

      {/* Mode 1: Assignation membre workspace existant */}
      {addMode === 'existing' && (
        <form onSubmit={handleAssignRole} className="assign-role-card">
          <div className="assign-form-row">
            <div className="assign-field">
              <label className="assign-label" htmlFor="member-select">
                <UserPlus size={14} /> Collaborateur existant
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
                      {isAlready ? ' — Déjà assigné (Modifier rôle)' : ''}
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
      )}

      {/* Mode 2: Invitation utilisateur externe */}
      {addMode === 'external' && (
        <form onSubmit={handleInviteExternal} className="assign-role-card">
          <div className="assign-form-row">
            <div className="assign-field">
              <label className="assign-label" htmlFor="external-email-input">
                <Mail size={14} /> Email du collaborateur externe
              </label>
              <input
                id="external-email-input"
                type="email"
                placeholder="ex: consultant@externe.com (ou vide pour lien libre)"
                className="assign-select"
                value={externalEmail}
                onChange={(e) => setExternalEmail(e.target.value)}
              />
            </div>

            <div className="assign-field">
              <label className="assign-label" htmlFor="external-role-select">
                <Shield size={14} /> Rôle sur ce projet
              </label>
              <select
                id="external-role-select"
                className="assign-select"
                value={externalRole}
                onChange={(e) =>
                  setExternalRole(e.target.value as 'CONTRIBUTOR' | 'COMMENTER' | 'CLIENT')
                }
              >
                <option value="CONTRIBUTOR">CONTRIBUTOR (Développeur, Prestataire)</option>
                <option value="COMMENTER">COMMENTER (Partenaire, Validateur)</option>
                <option value="CLIENT">CLIENT (Client final, Accès lecture seule)</option>
              </select>
            </div>

            <button type="submit" className="assign-submit-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Envoi...' : 'Générer / Envoyer l’invitation'}
            </button>
          </div>

          {generatedInviteLink && (
            <div className="generated-link-card">
              <div className="generated-link-info">
                <ExternalLink size={16} color="var(--accent-primary)" />
                <span className="generated-link-text">{generatedInviteLink}</span>
              </div>
              <button
                type="button"
                onClick={handleCopyLink}
                className={`copy-link-btn ${copiedLink ? 'copied' : ''}`}
              >
                {copiedLink ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                <span>{copiedLink ? 'Lien Copié !' : 'Copier le lien'}</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* Invitations en attente pour ce projet */}
      {projectInvitations.length > 0 && (
        <div className="pending-invitations-card">
          <h4 className="pending-invitations-title">
            <Clock size={16} /> Invitations en attente pour ce projet ({projectInvitations.length})
          </h4>
          <div className="pending-invitations-list">
            {projectInvitations.map((inv) => (
              <div key={inv.id} className="pending-invitation-item">
                <div className="pending-invitation-details">
                  <span className="pending-invitation-email">
                    {inv.email || 'Lien de partage public'}
                  </span>
                  <span className="pending-invitation-meta">
                    Expire le {new Date(inv.expiresAt).toLocaleDateString()} • Invité par{' '}
                    {inv.invitedBy?.name || inv.invitedBy?.email || 'Admin'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeInvitation(inv.id)}
                  className="pending-invitation-revoke-btn"
                  title="Révoquer l'invitation"
                >
                  <Trash2 size={14} /> Annuler
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liste des membres assignés au projet */}
      <div className="members-table-container">
        <div className="members-table-header">
          <h4 className="members-table-title">
            <UserCheck size={16} /> Membres actifs du projet ({members.length})
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
