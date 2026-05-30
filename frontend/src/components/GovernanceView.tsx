import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import { ShieldCheck, Flag, CheckSquare, Plus, Check, X, FileText, Truck, Link } from 'lucide-react'
import { RadialProgressRing } from './RadialProgressRing'
import { NumberTicker } from './NumberTicker'
import { IntegrationsPanel } from './IntegrationsPanel'
import './GovernanceView.css'

export const GovernanceView: React.FC = () => {
  const {
    projects,
    workspaces,
    workspaceMembers,
    createMilestone,
    completeMilestone,
    createDeliverable,
    updateDeliverableStatus,
    createDelivery,
    updateDeliveryStatus,
    toggleDeliveryChecklistItem,
  } = useApp()

  const [selectedProjId, setSelectedProjId] = useState<string>(projects[0]?.id || '')
  const [activeSubTab, setActiveSubTab] = useState<'project' | 'integrations'>('project')
  
  // Modals / forms states
  const [showMilestoneForm, setShowMilestoneForm] = useState(false)
  const [msName, setMsName] = useState('')
  const [msDesc, setMsDesc] = useState('')
  const [msDueDate, setMsDueDate] = useState('')

  const [showDeliverableForm, setShowDeliverableForm] = useState(false)
  const [delTitle, setDelTitle] = useState('')
  const [delDesc, setDelDesc] = useState('')
  const [delDueDate, setDelDueDate] = useState('')
  const [delStatus, setDelStatus] = useState<'DRAFT' | 'READY_FOR_REVIEW' | 'ACCEPTED' | 'DELIVERED'>('DRAFT')

  const [showDeliveryForm, setShowDeliveryForm] = useState(false)
  const [deliverySummary, setDeliverySummary] = useState('')
  const [deliveryChecklistRaw, setDeliveryChecklistRaw] = useState('')

  const activeProject = projects.find(p => p.id === selectedProjId) || projects[0]
  const activeWorkspace = workspaces[0] // or derived from project

  const handleCreateMilestone = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!msName.trim() || !activeProject) return
    await createMilestone(activeProject.id, msName, msDesc, msDueDate || undefined)
    setMsName('')
    setMsDesc('')
    setMsDueDate('')
    setShowMilestoneForm(false)
  }

  const handleCreateDeliverable = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!delTitle.trim() || !activeProject) return
    await createDeliverable(activeProject.id, delTitle, delDesc, delStatus, delDueDate || undefined)
    setDelTitle('')
    setDelDesc('')
    setDelDueDate('')
    setDelStatus('DRAFT')
    setShowDeliverableForm(false)
  }

  const handleCreateDelivery = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeProject) return
    const checklist = deliveryChecklistRaw
      .split('\n')
      .map(item => item.trim())
      .filter(item => item.length > 0)

    await createDelivery(activeProject.id, deliverySummary, checklist)
    setDeliverySummary('')
    setDeliveryChecklistRaw('')
    setShowDeliveryForm(false)
  }

  const allTasks = activeProject?.tasks || []
  const completedTasksCount = allTasks.filter(t => t.status === 'DONE').length
  const totalTasksCount = allTasks.length

  const allDeliverables = activeProject?.deliverables || []
  const acceptedDeliverablesCount = allDeliverables.filter(d => d.status === 'ACCEPTED' || d.status === 'DELIVERED').length
  const totalDeliverablesCount = allDeliverables.length

  const isReadyForDelivery = totalTasksCount > 0 && completedTasksCount === totalTasksCount &&
    totalDeliverablesCount > 0 && acceptedDeliverablesCount === totalDeliverablesCount



  return (
    <div className="governance-container">
      {/* Workspace & Team Header */}
      <section className="workspace-header-section">
        <div className="workspace-info-card">
          <div className="workspace-logo-placeholder">
            {activeWorkspace?.name.slice(0, 2).toUpperCase() || 'WP'}
          </div>
          <div>
            <h2 className="workspace-title">{activeWorkspace?.name || 'Espace de Travail'}</h2>
            <p className="workspace-meta">
              Propriétaire : {workspaceMembers.find(m => m.role === 'OWNER')?.user.name || 'Admin'}
            </p>
          </div>
        </div>

        <div className="workspace-members-list">
          {workspaceMembers.map(member => (
            <div
              key={member.id}
              className="member-avatar"
              title={`${member.user.name || member.user.email} (${member.role})`}
            >
              {(member.user.name || member.user.email).slice(0, 2).toUpperCase()}
            </div>
          ))}
        </div>
      </section>

      {projects.length === 0 ? (
        <div className="empty-state-gov">
          <ShieldCheck size={48} color="var(--accent-primary)" />
          <h3 className="empty-state-title">Aucun projet professionnel disponible</h3>
          <p className="empty-state-desc">Créez un projet dans le module Kanban pour commencer à gérer vos jalons et livrables.</p>
        </div>
      ) : (
        <div className="governance-layout">
          {/* Sidebar - Liste des Projets */}
          <aside className="sidebar-panel">
            <div className="project-list-card">
              <h3 className="panel-title">
                <FileText size={18} color="var(--accent-primary)" /> Projets
              </h3>
              <div className="project-selector-list">
                {projects.map(proj => (
                  <div
                    key={proj.id}
                    onClick={() => {
                      setSelectedProjId(proj.id)
                      setShowMilestoneForm(false)
                      setShowDeliverableForm(false)
                      setShowDeliveryForm(false)
                    }}
                    className={`project-item ${proj.id === activeProject?.id ? 'project-item--active' : ''}`}
                  >
                    <span className="project-item-name">{proj.name}</span>
                    <span className={`project-item-status badge badge--${(proj.status || 'PLANNING').toLowerCase().replace('_', '')}`}>
                      {proj.status || 'PLANNING'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* Main Governance Content */}
          <main className="main-governance-panel">
            {/* Barre d'onglets moderne */}
            <div className="gov-tabs-bar" style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '10px' }}>
              <button
                onClick={() => setActiveSubTab('project')}
                className={`gov-tab-btn ${activeSubTab === 'project' ? 'active' : ''}`}
                style={{
                  background: activeSubTab === 'project' ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(236, 72, 153, 0.15))' : 'transparent',
                  border: activeSubTab === 'project' ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid transparent',
                  color: activeSubTab === 'project' ? '#f3f4f6' : '#9ca3af',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
              >
                <FileText size={16} /> Gouvernance Projet
              </button>
              <button
                onClick={() => setActiveSubTab('integrations')}
                className={`gov-tab-btn ${activeSubTab === 'integrations' ? 'active' : ''}`}
                style={{
                  background: activeSubTab === 'integrations' ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(236, 72, 153, 0.15))' : 'transparent',
                  border: activeSubTab === 'integrations' ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid transparent',
                  color: activeSubTab === 'integrations' ? '#f3f4f6' : '#9ca3af',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
              >
                <Link size={16} /> Intégrations & Sync
              </button>
            </div>

            {activeSubTab === 'project' && (
              <>
                {/* Clôture Bilan de projet (Phase 4) */}
            {activeProject?.status === 'DELIVERED' && (
              <div className="gov-card closure-report-glow">
                <div className="closure-header">
                  <h3 className="closure-title">🏆 Projet Clôturé & Livré avec Succès</h3>
                  <p className="workspace-meta">Bilan et performance globale de livraison</p>
                </div>
                <div className="closure-stats-grid">
                  <div className="closure-stat-card">
                    <div className="closure-stat-value">{totalTasksCount}</div>
                    <div className="closure-stat-label">Tâches Livrées</div>
                  </div>
                  <div className="closure-stat-card">
                    <div className="closure-stat-value">100%</div>
                    <div className="closure-stat-label">Taux d'Acceptation</div>
                  </div>
                  <div className="closure-stat-card">
                    <div className="closure-stat-value">
                      {activeProject.milestones?.length || 0}
                    </div>
                    <div className="closure-stat-label">Jalons Atteints</div>
                  </div>
                  <div className="closure-stat-card">
                    <div className="closure-stat-value">
                      {activeProject.deliverables?.length || 0}
                    </div>
                    <div className="closure-stat-label">Livrables Validés</div>
                  </div>
                </div>
                <div className="closure-details-card">
                  <div className="closure-detail-row">
                    <span className="closure-detail-label">Date de clôture :</span>
                    <span className="closure-detail-value">
                      {activeProject.deliveries?.[0]?.acceptedAt 
                        ? new Date(activeProject.deliveries[0].acceptedAt).toLocaleDateString()
                        : new Date().toLocaleDateString()
                      }
                    </span>
                  </div>
                  <div className="closure-detail-row">
                    <span className="closure-detail-label">Statut Final :</span>
                    <span className="closure-detail-value text-success">ACCEPTED & CLOSED</span>
                  </div>
                </div>
              </div>
            )}

            {/* Project Overview Card (Premium Widget) */}
            {activeProject && (
              <div className="gov-card project-overview-premium-card" style={{ marginBottom: '20px' }}>
                <div className="project-overview-layout">
                  <div className="project-overview-info">
                    <span className="project-meta-label">Vue d'ensemble</span>
                    <h3 className="project-overview-title">{activeProject.name}</h3>
                    <p className="project-overview-description">
                      {activeProject.description || "Aucune description fournie pour ce projet."}
                    </p>
                    <div className="project-quick-stats">
                      <div className="quick-stat-item">
                        <span className="quick-stat-label">Tâches</span>
                        <span className="quick-stat-value">
                          <NumberTicker value={completedTasksCount} /> / {totalTasksCount}
                        </span>
                      </div>
                      <div className="quick-stat-item">
                        <span className="quick-stat-label">Livrables</span>
                        <span className="quick-stat-value">
                          <NumberTicker value={acceptedDeliverablesCount} /> / {totalDeliverablesCount}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="project-overview-ring-container">
                    <RadialProgressRing 
                      value={totalTasksCount > 0 ? (completedTasksCount / totalTasksCount) * 100 : 0} 
                      status={activeProject.status} 
                      size={130}
                      strokeWidth={11}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Grid Jalons & Livrables */}
            <div className="governance-grid-widgets">
              {/* Jalons (Milestones) */}
              <section className="gov-card">
                <div className="gov-card-header">
                  <h3 className="gov-card-title">
                    <Flag size={18} color="var(--accent-primary)" style={{ marginRight: '8px' }} />
                    Jalons
                  </h3>
                  <button
                    onClick={() => setShowMilestoneForm(!showMilestoneForm)}
                    className="form-toggle-btn"
                  >
                    <Plus size={16} /> Ajouter
                  </button>
                </div>

                {showMilestoneForm && (
                  <form onSubmit={handleCreateMilestone} className="inline-form">
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Nom du jalon</label>
                        <input
                          type="text"
                          required
                          value={msName}
                          onChange={e => setMsName(e.target.value)}
                          className="gov-input"
                          placeholder="Ex: Spécifications validées"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Description</label>
                        <textarea
                          value={msDesc}
                          onChange={e => setMsDesc(e.target.value)}
                          className="gov-textarea"
                          placeholder="Détails du jalon..."
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Échéance</label>
                        <input
                          type="date"
                          value={msDueDate}
                          onChange={e => setMsDueDate(e.target.value)}
                          className="gov-input"
                        />
                      </div>
                    </div>
                    <div className="form-actions">
                      <button
                        type="button"
                        onClick={() => setShowMilestoneForm(false)}
                        className="btn-secondary"
                      >
                        Annuler
                      </button>
                      <button type="submit" className="btn-primary">
                        Enregistrer
                      </button>
                    </div>
                  </form>
                )}

                <div className="gov-list">
                  {(!activeProject?.milestones || activeProject.milestones.length === 0) ? (
                    <p className="workspace-meta text-center" style={{ padding: '20px' }}>
                      Aucun jalon défini pour ce projet.
                    </p>
                  ) : (
                    activeProject.milestones.map(ms => (
                      <div key={ms.id} className="gov-item">
                        <div className="gov-item-left">
                          <span className="gov-item-title">{ms.name}</span>
                          {ms.description && <p className="gov-item-desc">{ms.description}</p>}
                          {ms.dueDate && (
                            <span className="gov-item-meta">
                              Échéance : {new Date(ms.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <div>
                          {ms.completedAt ? (
                            <span className="badge badge--done">Atteint</span>
                          ) : (
                            <button
                              onClick={() => completeMilestone(ms.id)}
                              className="btn-icon-label btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                            >
                              <Check size={12} /> Valider
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Livrables (Deliverables) */}
              <section className="gov-card">
                <div className="gov-card-header">
                  <h3 className="gov-card-title">
                    <CheckSquare size={18} color="var(--accent-primary)" style={{ marginRight: '8px' }} />
                    Livrables
                  </h3>
                  <button
                    onClick={() => setShowDeliverableForm(!showDeliverableForm)}
                    className="form-toggle-btn"
                  >
                    <Plus size={16} /> Ajouter
                  </button>
                </div>

                {showDeliverableForm && (
                  <form onSubmit={handleCreateDeliverable} className="inline-form">
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Titre du livrable</label>
                        <input
                          type="text"
                          required
                          value={delTitle}
                          onChange={e => setDelTitle(e.target.value)}
                          className="gov-input"
                          placeholder="Ex: Code Source v1.0"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Description</label>
                        <textarea
                          value={delDesc}
                          onChange={e => setDelDesc(e.target.value)}
                          className="gov-textarea"
                          placeholder="Lien ou résumé du livrable..."
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Échéance</label>
                        <input
                          type="date"
                          value={delDueDate}
                          onChange={e => setDelDueDate(e.target.value)}
                          className="gov-input"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Statut Initial</label>
                        <select
                          value={delStatus}
                          onChange={e => setDelStatus(e.target.value as any)}
                          className="gov-select"
                        >
                          <option value="DRAFT">Brouillon</option>
                          <option value="READY_FOR_REVIEW">En Revue</option>
                          <option value="ACCEPTED">Accepté</option>
                          <option value="DELIVERED">Livré</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-actions">
                      <button
                        type="button"
                        onClick={() => setShowDeliverableForm(false)}
                        className="btn-secondary"
                      >
                        Annuler
                      </button>
                      <button type="submit" className="btn-primary">
                        Créer
                      </button>
                    </div>
                  </form>
                )}

                <div className="gov-list">
                  {(!activeProject?.deliverables || activeProject.deliverables.length === 0) ? (
                    <p className="workspace-meta text-center" style={{ padding: '20px' }}>
                      Aucun livrable défini pour ce projet.
                    </p>
                  ) : (
                    activeProject.deliverables.map(del => (
                      <div key={del.id} className="gov-item">
                        <div className="gov-item-left">
                          <span className="gov-item-title">{del.title}</span>
                          {del.description && <p className="gov-item-desc">{del.description}</p>}
                          {del.dueDate && (
                            <span className="gov-item-meta">
                              Échéance : {new Date(del.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <div>
                          <select
                            value={del.status}
                            onChange={e => updateDeliverableStatus(del.id, e.target.value)}
                            className="gov-select"
                            style={{ padding: '2px 6px', fontSize: '11px', borderRadius: 'var(--radius-xs)' }}
                          >
                            <option value="DRAFT">Brouillon</option>
                            <option value="READY_FOR_REVIEW">En Revue</option>
                            <option value="ACCEPTED">Accepté</option>
                            <option value="DELIVERED">Livré</option>
                          </select>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            {/* Validation & Workflow de Livraison (Phase 4) */}
            <section className="gov-card delivery-section">
              <div className="gov-card-header">
                <h3 className="gov-card-title">
                  <Truck size={18} color="var(--accent-primary)" style={{ marginRight: '8px' }} />
                  workflow de Validation & Livraison
                </h3>
                {isReadyForDelivery && activeProject?.status !== 'DELIVERED' && (
                  <button
                    onClick={() => setShowDeliveryForm(!showDeliveryForm)}
                    className="btn-primary btn-icon-label"
                  >
                    <Plus size={16} /> Initier Livraison
                  </button>
                )}
              </div>

              {showDeliveryForm && (
                <form onSubmit={handleCreateDelivery} className="delivery-record-card">
                  <h4 className="checklist-title">Nouvelle proposition de livraison</h4>
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Résumé / Rapport de livraison</label>
                      <textarea
                        required
                        value={deliverySummary}
                        onChange={e => setDeliverySummary(e.target.value)}
                        className="gov-textarea"
                        placeholder="Présentez les fonctionnalités livrées, les liens, etc."
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Checklist de validation (un item par ligne)</label>
                      <textarea
                        required
                        value={deliveryChecklistRaw}
                        onChange={e => setDeliveryChecklistRaw(e.target.value)}
                        className="gov-textarea"
                        placeholder="Ex:&#10;Code source audité&#10;Tests d'intégration au vert&#10;Validation client effectuée"
                      />
                    </div>
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      onClick={() => setShowDeliveryForm(false)}
                      className="btn-secondary"
                    >
                      Annuler
                    </button>
                    <button type="submit" className="btn-primary">
                      Soumettre la livraison
                    </button>
                  </div>
                </form>
              )}

              {/* Historique des Livraisons */}
              <div className="gov-list" style={{ maxHeight: 'none' }}>
                {(!activeProject?.deliveries || activeProject.deliveries.length === 0) ? (
                  <div className="empty-state-gov" style={{ padding: '20px' }}>
                    <p className="workspace-meta text-center">Aucune livraison en cours ou passée.</p>
                    {totalTasksCount > 0 && !isReadyForDelivery && (
                      <p className="workspace-meta text-center" style={{ fontSize: '11px', color: 'var(--color-warning)' }}>
                        ⚠️ Pour débloquer la livraison, terminez toutes les tâches de ce projet et validez l'ensemble de ses livrables.
                      </p>
                    )}
                  </div>
                ) : (
                  activeProject.deliveries.map(dev => (
                    <div key={dev.id} className="delivery-record-card" style={{ marginBottom: '10px' }}>
                      <div className="delivery-record-header">
                        <div>
                          <span className={`badge badge--${dev.status.toLowerCase().replace(/_/g, '')}`}>
                            Livraison : {dev.status}
                          </span>
                          <span className="workspace-meta" style={{ marginLeft: '12px' }}>
                            Créée le : {new Date(dev.deliveredAt || new Date()).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="form-actions" style={{ margin: 0, gap: '8px' }}>
                          {dev.status === 'DRAFT' && (
                            <button
                              onClick={() => updateDeliveryStatus(dev.id, 'READY_FOR_ACCEPTANCE')}
                              className="btn-primary"
                              style={{ padding: '3px 8px', fontSize: '11px' }}
                            >
                              Soumettre à validation
                            </button>
                          )}
                          {dev.status === 'READY_FOR_ACCEPTANCE' && (
                            <>
                              <button
                                onClick={() => updateDeliveryStatus(dev.id, 'ACCEPTED')}
                                className="btn-icon-label btn-primary"
                                style={{ padding: '3px 8px', fontSize: '11px', background: 'var(--color-success)' }}
                              >
                                <Check size={12} /> Accepter
                              </button>
                              <button
                                onClick={() => updateDeliveryStatus(dev.id, 'REJECTED')}
                                className="btn-icon-label btn-secondary"
                                style={{ padding: '3px 8px', fontSize: '11px', background: 'var(--color-error)' }}
                              >
                                <X size={12} /> Rejeter
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {dev.summary && (
                        <p className="gov-item-desc" style={{ marginBottom: '15px', whiteSpace: 'pre-wrap' }}>
                          {dev.summary}
                        </p>
                      )}

                      {dev.checklist && dev.checklist.length > 0 && (
                        <div>
                          <h5 className="checklist-title">Checklist d'acceptation</h5>
                          <div className="checklist-container">
                            {dev.checklist.map(item => (
                              <div
                                key={item.id}
                                onClick={() => toggleDeliveryChecklistItem(item.id)}
                                className={`checklist-item ${item.checked ? 'checklist-item--checked' : ''}`}
                              >
                                <div className={`checklist-item-checkbox ${item.checked ? 'checklist-item-checkbox--checked' : ''}`}>
                                  {item.checked && <Check size={10} strokeWidth={3} />}
                                </div>
                                <span className={`checklist-item-text ${item.checked ? 'checklist-item-text--checked' : ''}`}>
                                  {item.title}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
              </>
            )}

            {activeSubTab === 'integrations' && activeWorkspace && (
              <IntegrationsPanel workspaceId={activeWorkspace.id} />
            )}
          </main>
        </div>
      )}
    </div>
  )
}
