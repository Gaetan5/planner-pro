import React, { useState, useEffect } from 'react';
import { ResourceCapacityReportItem, WorkspaceMember, useApp } from '../context/AppContext';
import {
  Users,
  AlertTriangle,
  Sliders,
  Clock,
  Award,
  Mail,
  Trash2,
  Copy,
  Check,
  Link,
} from 'lucide-react';
import { NumberTicker } from './NumberTicker';
import './CapacityView.css';

export const CapacityView: React.FC = () => {
  const {
    user,
    projects,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    updateResourceProfile,
    getResourceCapacityReport,
    getWorkspaceMembers,
    createResourceAllocation,
    refreshData,
    createInvitation,
    listInvitations,
    revokeInvitation,
  } = useApp();

  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [resourceCapacity, setResourceCapacity] = useState<ResourceCapacityReportItem[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setWorkspaceMembers([]);
      setResourceCapacity([]);
      return;
    }

    let cancelled = false;
    setWorkspaceLoading(true);
    setWorkspaceLoadError(null);

    Promise.all([
      getWorkspaceMembers(activeWorkspaceId),
      getResourceCapacityReport(activeWorkspaceId),
    ])
      .then(([members, capacity]) => {
        if (cancelled) return;
        setWorkspaceMembers(members);
        setResourceCapacity(capacity);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setWorkspaceLoadError(
          err instanceof Error ? err.message : 'Impossible de charger les données du workspace.',
        );
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, getResourceCapacityReport, getWorkspaceMembers]);

  const workspaceProjects = projects.filter(
    (project) => (project.workspaceId || project.workspace?.id) === activeWorkspaceId,
  );

  const refreshWorkspaceCapacity = async () => {
    if (!activeWorkspaceId) return;
    try {
      setResourceCapacity(await getResourceCapacityReport(activeWorkspaceId));
      setWorkspaceLoadError(null);
    } catch (err) {
      setWorkspaceLoadError(
        err instanceof Error
          ? err.message
          : 'Impossible de rafraîchir les ressources du workspace.',
      );
    }
  };

  const handleOptimize = async () => {
    if (!activeWorkspaceId) {
      alert("Aucun espace de travail disponible pour l'optimisation.");
      return;
    }

    setIsOptimizing(true);
    try {
      const token = localStorage.getItem('token') || user?.token;
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/projects/workspaces/${activeWorkspaceId}/resources/optimize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!res.ok) {
        throw new Error('Échec de la réallocation des ressources.');
      }

      const result = await res.json();
      alert(result.message || 'Optimisation des ressources effectuée avec succès !');
      await refreshData();
      await refreshWorkspaceCapacity();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de l'optimisation des ressources d'équipe.");
    } finally {
      setIsOptimizing(false);
    }
  };

  // Form 1 states (Profile Config)
  const [profileUserId, setProfileUserId] = useState('');
  const [profileHours, setProfileHours] = useState('40');
  const [profileSkills, setProfileSkills] = useState('');
  const [profileCostRate, setProfileCostRate] = useState('');

  // Form 2 states (Allocation Config)
  const [allocUserId, setAllocUserId] = useState('');
  const [allocProjId, setAllocProjId] = useState('');
  const [allocRoleLabel, setAllocRoleLabel] = useState('');
  const [allocPercent, setAllocPercent] = useState('100');
  const [allocStartDate, setAllocStartDate] = useState('');
  const [allocEndDate, setAllocEndDate] = useState('');

  // Collaboration / Invitation states
  const [invitations, setInvitations] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');
  const [inviteProjId, setInviteProjId] = useState('');
  const [inviteDuration, setInviteDuration] = useState('2');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);

  const loadInvitationsList = async () => {
    if (activeWorkspaceId) {
      setInvitationError(null);
      try {
        const list = await listInvitations(activeWorkspaceId);
        setInvitations(list);
      } catch (err) {
        console.error('Erreur lors de la récupération des invitations :', err);
        setInvitationError(
          err instanceof Error ? err.message : 'Impossible de charger les invitations.',
        );
      }
    }
  };

  useEffect(() => {
    loadInvitationsList();
  }, [activeWorkspaceId]);

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId) {
      alert('Aucun workspace actif sélectionné.');
      return;
    }

    try {
      const result = await createInvitation(
        activeWorkspaceId,
        inviteEmail || null,
        inviteRole as any,
        inviteProjId || undefined,
        Number(inviteDuration),
      );
      const joinUrl = `${window.location.origin}/?token=${result.rawToken}`;
      setGeneratedLink(joinUrl);
      setInviteEmail('');
      alert('Invitation générée avec succès !');
      await loadInvitationsList();
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Une erreur s'est produite lors de la génération de l'invitation.",
      );
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (window.confirm('Voulez-vous vraiment révoquer cette invitation active ?')) {
      try {
        await revokeInvitation(invitationId);
        await loadInvitationsList();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Impossible de révoquer l'invitation.");
      }
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileUserId) return;

    const minutes = Math.round(Number(profileHours) * 60);
    const costRate = profileCostRate ? Math.round(Number(profileCostRate) * 100) : undefined;

    await updateResourceProfile(
      profileUserId,
      minutes,
      profileSkills || undefined,
      costRate,
      activeWorkspaceId,
    );
    await refreshWorkspaceCapacity();

    // Reset or show success
    alert('Profil de ressource mis à jour avec succès !');
  };

  const handleCreateAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allocUserId || !allocProjId) return;

    await createResourceAllocation(
      allocProjId,
      allocUserId,
      Number(allocPercent) || 100,
      allocRoleLabel || undefined,
      allocStartDate || undefined,
      allocEndDate || undefined,
    );
    await refreshWorkspaceCapacity();

    alert('Affectation enregistrée avec succès !');
    setAllocRoleLabel('');
    setAllocPercent('100');
    setAllocStartDate('');
    setAllocEndDate('');
  };

  const formatHours = (minutes: number) => {
    return Math.round((minutes / 60) * 10) / 10;
  };

  return (
    <div className="capacity-container">
      <div
        className="capacity-title-section"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-xl)',
          flexWrap: 'wrap',
          gap: 'var(--space-md)',
        }}
      >
        <div>
          <h2
            className="panel-title"
            style={{
              fontSize: 'var(--font-3xl)',
              marginBottom: 'var(--space-xs)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-xs)',
            }}
          >
            <Users size={28} color="var(--accent-primary)" /> Gestion des Ressources & Capacité
          </h2>
          <p className="workspace-meta" style={{ fontSize: 'var(--font-base)', margin: 0 }}>
            Supervisez la charge hebdomadaire, identifiez les surcharges et allouez vos membres aux
            projets stratégiques.
          </p>
        </div>
        <label className="form-group">
          <span className="form-label">Workspace</span>
          <select
            className="gov-select"
            aria-label="Workspace des ressources"
            value={activeWorkspaceId}
            onChange={(event) => {
              setActiveWorkspaceId(event.target.value);
              setAllocProjId('');
              setInviteProjId('');
            }}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={handleOptimize}
          disabled={isOptimizing}
          className={`btn-optimize-glowing ${isOptimizing ? 'btn-optimize-glowing--loading' : ''}`}
        >
          {isOptimizing ? (
            <>
              <span className="spinner-loader"></span>
              Optimisation IA...
            </>
          ) : (
            <>
              <Sliders size={16} />
              Optimiser la charge
            </>
          )}
        </button>
      </div>

      <div className="capacity-grid-layout">
        {/* Liste des Membres et charges de travail */}
        <div className="members-cards-container">
          {workspaceLoadError ? (
            <p className="workspace-meta" role="alert">
              {workspaceLoadError}
            </p>
          ) : workspaceLoading ? (
            <p className="workspace-meta">Chargement des ressources du workspace...</p>
          ) : resourceCapacity.length === 0 ? (
            <div className="member-capacity-card text-center" style={{ padding: '40px' }}>
              <Users
                size={32}
                color="var(--text-muted)"
                style={{ margin: '0 auto var(--space-md)' }}
              />
              <p className="workspace-meta">
                Aucune ressource disponible dans cet espace de travail.
              </p>
            </div>
          ) : (
            resourceCapacity.map((item) => {
              const capHours = formatHours(item.weeklyCapacityMinutes);
              const plannedHours = formatHours(item.plannedMinutes);
              const initials = (item.user.name || item.user.email).slice(0, 2).toUpperCase();

              return (
                <div
                  key={item.user.id}
                  className={`member-capacity-card ${item.overloaded ? 'member-capacity-card--overloaded' : ''}`}
                >
                  <div className="member-card-header">
                    <div className="member-primary-info">
                      <div className="member-large-avatar">{initials}</div>
                      <div>
                        <h4 className="member-name">{item.user.name || 'Collaborateur'}</h4>
                        <p className="member-role-label">
                          Role : {item.role} • {item.user.email}
                        </p>
                      </div>
                    </div>

                    {item.overloaded && (
                      <div className="conflict-tags-list">
                        {item.conflicts.map((conflict) => (
                          <span key={conflict} className="conflict-badge">
                            <AlertTriangle size={12} />
                            {conflict === 'CAPACITY_EXCEEDED' ? 'Capacité Dépassée' : 'Surchargé'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Skills tags */}
                  {item.profile?.skills && (
                    <div className="skills-tags-section">
                      <Award size={14} color="var(--accent-secondary)" />
                      {item.profile.skills.split(',').map((skill, index) => (
                        <span key={index} className="skill-tag">
                          {skill.trim()}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Metrics grid */}
                  <div className="member-metrics-grid">
                    <div className="metric-card-item">
                      <div className="metric-value">
                        <NumberTicker value={capHours} suffix="h" />
                      </div>
                      <div className="metric-label">Capacité Hebdo</div>
                    </div>
                    <div className="metric-card-item">
                      <div
                        className={`metric-value ${item.plannedMinutes > item.weeklyCapacityMinutes ? 'metric-value--over' : ''}`}
                      >
                        <NumberTicker value={plannedHours} suffix="h" />
                      </div>
                      <div className="metric-label">Planifié (Calendrier)</div>
                    </div>
                    <div className="metric-card-item">
                      <div className="metric-value">
                        <NumberTicker value={item.allocationPercent} suffix="%" />
                      </div>
                      <div className="metric-label">Taux d'Allocation</div>
                    </div>
                    <div className="metric-card-item">
                      <div
                        className={`metric-value ${item.loadPercent > 100 ? 'metric-value--over' : ''}`}
                      >
                        <NumberTicker value={item.loadPercent} suffix="%" />
                      </div>
                      <div className="metric-label">Taux de Charge</div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar avec formulaires de configuration */}
        <div className="forms-sidebar">
          {/* Form 1 : Profil Ressource */}
          <div className="config-form-card">
            <h3 className="form-title-small">
              <Sliders size={16} color="var(--accent-primary)" style={{ marginRight: '8px' }} />
              Configuration du Profil
            </h3>
            <form onSubmit={handleUpdateProfile} className="form-grid">
              <div className="form-group">
                <label className="form-label">Membre d'équipe</label>
                <select
                  required
                  value={profileUserId}
                  onChange={(e) => setProfileUserId(e.target.value)}
                  className="gov-select"
                >
                  <option value="">Sélectionner...</option>
                  {workspaceMembers.map((m) => (
                    <option key={m.id} value={m.user.id}>
                      {m.user.name || m.user.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Capacité hebdo (heures)</label>
                <input
                  type="number"
                  required
                  value={profileHours}
                  onChange={(e) => setProfileHours(e.target.value)}
                  className="gov-input"
                  min="1"
                  max="168"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Compétences (séparées par virgules)</label>
                <input
                  type="text"
                  value={profileSkills}
                  onChange={(e) => setProfileSkills(e.target.value)}
                  className="gov-input"
                  placeholder="React, NestJS, CSS, QA"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Coût horaire (EUR)</label>
                <input
                  type="number"
                  value={profileCostRate}
                  onChange={(e) => setProfileCostRate(e.target.value)}
                  className="gov-input"
                  placeholder="Ex: 50"
                />
              </div>

              <button type="submit" className="btn-full btn-full-primary">
                Sauvegarder le profil
              </button>
            </form>
          </div>

          {/* Form 2 : Allocation de Projet */}
          <div className="config-form-card">
            <h3 className="form-title-small">
              <Clock size={16} color="var(--accent-primary)" style={{ marginRight: '8px' }} />
              Affectation au Projet
            </h3>
            <form onSubmit={handleCreateAllocation} className="form-grid">
              <div className="form-group">
                <label className="form-label">Collaborateur</label>
                <select
                  required
                  value={allocUserId}
                  onChange={(e) => setAllocUserId(e.target.value)}
                  className="gov-select"
                >
                  <option value="">Sélectionner...</option>
                  {workspaceMembers.map((m) => (
                    <option key={m.id} value={m.user.id}>
                      {m.user.name || m.user.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Projet de destination</label>
                <select
                  required
                  value={allocProjId}
                  onChange={(e) => setAllocProjId(e.target.value)}
                  className="gov-select"
                >
                  <option value="">Sélectionner...</option>
                  {workspaceProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Rôle sur le projet</label>
                <input
                  type="text"
                  value={allocRoleLabel}
                  onChange={(e) => setAllocRoleLabel(e.target.value)}
                  className="gov-input"
                  placeholder="Ex: Lead Developer"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Allocation (%)</label>
                <input
                  type="number"
                  required
                  value={allocPercent}
                  onChange={(e) => setAllocPercent(e.target.value)}
                  className="gov-input"
                  min="1"
                  max="100"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Date de début</label>
                <input
                  type="date"
                  value={allocStartDate}
                  onChange={(e) => setAllocStartDate(e.target.value)}
                  className="gov-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Date de fin</label>
                <input
                  type="date"
                  value={allocEndDate}
                  onChange={(e) => setAllocEndDate(e.target.value)}
                  className="gov-input"
                />
              </div>

              <button type="submit" className="btn-full btn-full-primary">
                Créer l'affectation
              </button>
            </form>
          </div>

          {/* Form 3 : Inviter un collaborateur */}
          <div className="config-form-card">
            <h3 className="form-title-small">
              <Mail size={16} color="var(--accent-primary)" style={{ marginRight: '8px' }} />
              Inviter un Collaborateur
            </h3>

            <form onSubmit={handleCreateInvitation} className="form-grid">
              <div className="form-group">
                <label className="form-label">Adresse E-mail (Optionnel)</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="gov-input"
                  placeholder="nom@exemple.com (laisser vide pour lien magique)"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Rôle Workspace</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="gov-select"
                >
                  <option value="MEMBER">Membre (Lecture/Écriture)</option>
                  <option value="ADMIN">Administrateur</option>
                  <option value="VIEWER">Observateur (Lecture seule)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Assignation Projet Initiale (Optionnel)</label>
                <select
                  value={inviteProjId}
                  onChange={(e) => setInviteProjId(e.target.value)}
                  className="gov-select"
                >
                  <option value="">Aucun projet</option>
                  {workspaceProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Validité de l'invitation</label>
                <select
                  value={inviteDuration}
                  onChange={(e) => setInviteDuration(e.target.value)}
                  className="gov-select"
                >
                  <option value="1">24 heures (Sécurité renforcée)</option>
                  <option value="2">48 heures (Standard)</option>
                  <option value="7">7 jours</option>
                </select>
              </div>

              <button type="submit" className="btn-full btn-full-primary">
                Générer l'Invitation
              </button>
            </form>

            {generatedLink && (
              <div
                className="invitation-link-box"
                style={{
                  marginTop: 'var(--space-md)',
                  padding: 'var(--space-sm)',
                  backgroundColor: 'rgba(235, 94, 85, 0.1)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--accent-primary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-xs)',
                }}
              >
                <p
                  className="form-label"
                  style={{
                    color: 'var(--accent-primary)',
                    marginBottom: 'var(--space-xs)',
                    fontWeight: 'bold',
                  }}
                >
                  Lien magique généré :
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                  <input
                    type="text"
                    readOnly
                    value={generatedLink}
                    className="gov-input"
                    style={{ fontSize: 'var(--font-xs)', flex: 1 }}
                  />
                  <button
                    onClick={() => copyToClipboard(generatedLink, 'new-link')}
                    className="btn-icon"
                    title="Copier le lien"
                    style={{ flexShrink: 0 }}
                  >
                    {copiedId === 'new-link' ? (
                      <Check size={16} color="green" />
                    ) : (
                      <Copy size={16} />
                    )}
                  </button>
                </div>
                <button
                  onClick={() => setGeneratedLink('')}
                  className="btn-text"
                  style={{
                    marginTop: 'var(--space-xs)',
                    fontSize: 'var(--font-xs)',
                    color: 'var(--text-muted)',
                  }}
                >
                  Masquer le lien
                </button>
              </div>
            )}
          </div>

          {/* Liste des Invitations actives */}
          <div className="config-form-card">
            <h3 className="form-title-small">
              <Link size={16} color="var(--accent-primary)" style={{ marginRight: '8px' }} />
              Invitations en Attente ({invitations.length})
            </h3>

            {invitationError ? (
              <p className="workspace-meta" role="alert">
                {invitationError}
              </p>
            ) : invitations.length === 0 ? (
              <p
                className="workspace-meta"
                style={{
                  fontSize: 'var(--font-xs)',
                  textAlign: 'center',
                  margin: 'var(--space-md) 0',
                }}
              >
                Aucune invitation en attente.
              </p>
            ) : (
              <div
                className="invitations-list-container"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}
              >
                {invitations.map((inv) => {
                  const expiryDate = new Date(inv.expiresAt).toLocaleDateString();

                  return (
                    <div
                      key={inv.id}
                      className="invitation-item-row"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: 'var(--space-xs)',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, marginRight: 'var(--space-xs)' }}>
                        <p
                          style={{
                            margin: 0,
                            fontWeight: '500',
                            fontSize: 'var(--font-xs)',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {inv.email || 'Lien Magique Générique'}
                        </p>
                        <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-muted)' }}>
                          Rôle : {inv.role} • Expire le {expiryDate}
                        </p>
                      </div>

                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => handleRevokeInvitation(inv.id)}
                          className="btn-icon btn-icon--danger"
                          title="Révoquer l'invitation"
                          style={{ padding: '4px' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
