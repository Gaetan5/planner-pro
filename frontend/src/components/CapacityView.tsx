import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Users, AlertTriangle, Sliders, Clock, Award } from 'lucide-react'
import { NumberTicker } from './NumberTicker'
import './CapacityView.css'

export const CapacityView: React.FC = () => {
  const {
    projects,
    workspaceMembers,
    resourceCapacity,
    updateResourceProfile,
    createResourceAllocation,
  } = useApp()

  // Form 1 states (Profile Config)
  const [profileUserId, setProfileUserId] = useState('')
  const [profileHours, setProfileHours] = useState('40')
  const [profileSkills, setProfileSkills] = useState('')
  const [profileCostRate, setProfileCostRate] = useState('')

  // Form 2 states (Allocation Config)
  const [allocUserId, setAllocUserId] = useState('')
  const [allocProjId, setAllocProjId] = useState('')
  const [allocRoleLabel, setAllocRoleLabel] = useState('')
  const [allocPercent, setAllocPercent] = useState('100')
  const [allocStartDate, setAllocStartDate] = useState('')
  const [allocEndDate, setAllocEndDate] = useState('')

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profileUserId) return
    
    const minutes = Math.round(Number(profileHours) * 60)
    const costRate = profileCostRate ? Math.round(Number(profileCostRate) * 100) : undefined

    await updateResourceProfile(profileUserId, minutes, profileSkills || undefined, costRate)
    
    // Reset or show success
    alert('Profil de ressource mis à jour avec succès !')
  }

  const handleCreateAllocation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!allocUserId || !allocProjId) return

    await createResourceAllocation(
      allocProjId,
      allocUserId,
      Number(allocPercent) || 100,
      allocRoleLabel || undefined,
      allocStartDate || undefined,
      allocEndDate || undefined
    )

    alert('Affectation enregistrée avec succès !')
    setAllocRoleLabel('')
    setAllocPercent('100')
    setAllocStartDate('')
    setAllocEndDate('')
  }

  const formatHours = (minutes: number) => {
    return Math.round((minutes / 60) * 10) / 10
  }

  return (
    <div className="capacity-container">
      <div className="capacity-title-section">
        <h2 className="panel-title" style={{ fontSize: 'var(--font-3xl)', marginBottom: 'var(--space-xs)' }}>
          <Users size={28} color="var(--accent-primary)" /> Gestion des Ressources & Capacité
        </h2>
        <p className="workspace-meta" style={{ fontSize: 'var(--font-base)' }}>
          Supervisez la charge hebdomadaire, identifiez les surcharges et allouez vos membres aux projets stratégiques.
        </p>
      </div>

      <div className="capacity-grid-layout">
        {/* Liste des Membres et charges de travail */}
        <div className="members-cards-container">
          {resourceCapacity.length === 0 ? (
            <div className="member-capacity-card text-center" style={{ padding: '40px' }}>
              <Users size={32} color="var(--text-muted)" style={{ margin: '0 auto var(--space-md)' }} />
              <p className="workspace-meta">Aucune ressource disponible dans cet espace de travail.</p>
            </div>
          ) : (
            resourceCapacity.map(item => {
              const capHours = formatHours(item.weeklyCapacityMinutes)
              const plannedHours = formatHours(item.plannedMinutes)
              const initials = (item.user.name || item.user.email).slice(0, 2).toUpperCase()

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
                        {item.conflicts.map(conflict => (
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
                      <div className={`metric-value ${item.plannedMinutes > item.weeklyCapacityMinutes ? 'metric-value--over' : ''}`}>
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
                      <div className={`metric-value ${item.loadPercent > 100 ? 'metric-value--over' : ''}`}>
                        <NumberTicker value={item.loadPercent} suffix="%" />
                      </div>
                      <div className="metric-label">Taux de Charge</div>
                    </div>
                  </div>
                </div>
              )
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
                  onChange={e => setProfileUserId(e.target.value)}
                  className="gov-select"
                >
                  <option value="">Sélectionner...</option>
                  {workspaceMembers.map(m => (
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
                  onChange={e => setProfileHours(e.target.value)}
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
                  onChange={e => setProfileSkills(e.target.value)}
                  className="gov-input"
                  placeholder="React, NestJS, CSS, QA"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Coût horaire (EUR)</label>
                <input
                  type="number"
                  value={profileCostRate}
                  onChange={e => setProfileCostRate(e.target.value)}
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
                  onChange={e => setAllocUserId(e.target.value)}
                  className="gov-select"
                >
                  <option value="">Sélectionner...</option>
                  {workspaceMembers.map(m => (
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
                  onChange={e => setAllocProjId(e.target.value)}
                  className="gov-select"
                >
                  <option value="">Sélectionner...</option>
                  {projects.map(p => (
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
                  onChange={e => setAllocRoleLabel(e.target.value)}
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
                  onChange={e => setAllocPercent(e.target.value)}
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
                  onChange={e => setAllocStartDate(e.target.value)}
                  className="gov-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Date de fin</label>
                <input
                  type="date"
                  value={allocEndDate}
                  onChange={e => setAllocEndDate(e.target.value)}
                  className="gov-input"
                />
              </div>

              <button type="submit" className="btn-full btn-full-primary">
                Créer l'affectation
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
