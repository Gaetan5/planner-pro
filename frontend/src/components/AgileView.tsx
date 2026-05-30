import React, { useState, useEffect } from 'react'
import { useApp, Sprint } from '../context/AppContext'
import { Calendar, Award, Plus, Check, Play, Square, RefreshCw, BarChart2, ListTodo, Clipboard, Sparkles } from 'lucide-react'
import './AgileView.css'

export const AgileView: React.FC = () => {
  const {
    user,
    workspaces,
    projects,
    updateTask,
    createSprint,
    updateSprintStatus,
    associateTasksToSprint,
    getBurndownData,
    getVelocityData,
    refreshData
  } = useApp()

  const [activeTab, setSubTab] = useState<'planning' | 'dashboard'>('planning')
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('')
  const [velocity, setVelocity] = useState<number>(0)
  const [burndownData, setBurndownData] = useState<any>(null)
  const [selectedSprintId, setSelectedSprintId] = useState<string>('')

  // Modale création sprint states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newSprintName, setNewSprintName] = useState('')
  const [newSprintStart, setNewSprintStart] = useState('')
  const [newSprintEnd, setNewSprintEnd] = useState('')

  // Story point editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingPoints, setEditingPoints] = useState<string>('')

  const token = user?.token

  // Définir le workspace actif initial
  useEffect(() => {
    if (workspaces.length > 0 && !activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0].id)
    }
  }, [workspaces])

  // Charger les sprints et la vélocité quand le workspace change
  const loadWorkspaceAgileData = async () => {
    if (!activeWorkspaceId) return
    try {
      // Charger la vélocité
      const vel = await getVelocityData(activeWorkspaceId)
      setVelocity(vel)

      // Charger les sprints
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3002'}/projects/workspaces/${activeWorkspaceId}/sprints`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )
      if (res.ok) {
        const data = await res.json()
        setSprints(data)
        // Sélectionner par défaut le sprint actif ou le premier
        const activeSprint = data.find((s: Sprint) => s.status === 'ACTIVE')
        if (activeSprint) {
          setSelectedSprintId(activeSprint.id)
        } else if (data.length > 0 && !selectedSprintId) {
          setSelectedSprintId(data[0].id)
        }
      }
    } catch (err) {
      console.error('Erreur lors du chargement des données agiles :', err)
    }
  }

  useEffect(() => {
    loadWorkspaceAgileData()
  }, [activeWorkspaceId])

  // Charger le burndown chart pour le sprint sélectionné
  useEffect(() => {
    const loadBurndown = async () => {
      if (!selectedSprintId) {
        setBurndownData(null)
        return
      }
      try {
        const data = await getBurndownData(selectedSprintId)
        setBurndownData(data)
      } catch (err) {
        console.error('Erreur lors du chargement du burndown chart :', err)
      }
    }
    loadBurndown()
  }, [selectedSprintId, sprints])

  // Créer un sprint
  const handleCreateSprint = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSprintName || !newSprintStart || !newSprintEnd || !activeWorkspaceId) return
    try {
      await createSprint(newSprintName, newSprintStart, newSprintEnd, activeWorkspaceId)
      setNewSprintName('')
      setNewSprintStart('')
      setNewSprintEnd('')
      setShowCreateModal(false)
      await loadWorkspaceAgileData()
    } catch (err) {
      alert('Erreur lors de la création du sprint')
    }
  }

  // Démarrer ou clôturer un sprint
  const handleUpdateSprintStatus = async (sprintId: string, status: 'ACTIVE' | 'COMPLETED') => {
    try {
      await updateSprintStatus(sprintId, status)
      await loadWorkspaceAgileData()
      await refreshData()
    } catch (err) {
      alert('Erreur lors du changement de statut du sprint')
    }
  }

  // Modifier les Story Points d'une tâche
  const handleSaveStoryPoints = async (taskId: string) => {
    const pts = parseInt(editingPoints, 10)
    if (isNaN(pts) || pts < 0) {
      alert('Veuillez entrer un nombre de points valide.')
      return
    }
    try {
      await updateTask(taskId, { storyPoints: pts })
      setEditingTaskId(null)
      await loadWorkspaceAgileData()
      await refreshData()
    } catch (err) {
      alert('Erreur lors de la mise à jour des points de story.')
    }
  }

  // Associer une tâche à un sprint ou la remettre au backlog
  const handleTaskSprintChange = async (taskId: string, targetSprintId: string | null) => {
    try {
      await associateTasksToSprint(targetSprintId, [taskId])
      await loadWorkspaceAgileData()
      await refreshData()
    } catch (err) {
      alert('Erreur lors du transfert de la tâche.')
    }
  }

  // Lister toutes les tâches du workspace actif
  const allWorkspaceTasks = projects
    .filter(p => p.workspaceId === activeWorkspaceId)
    .flatMap(p => (p.tasks || []).map(t => ({ ...t, projectName: p.name })))

  // Backlog: tâches non complétées ET non associées à un sprint
  const backlogTasks = allWorkspaceTasks.filter(t => t.status !== 'DONE' && !t.sprintId)

  // Tâches du sprint sélectionné
  const currentSprintTasks = allWorkspaceTasks.filter(t => t.sprintId === selectedSprintId)

  const selectedSprint = sprints.find(s => s.id === selectedSprintId)

  // Calcul du nombre de jours restants pour le sprint actif
  const getDaysRemaining = (sprint: Sprint) => {
    const end = new Date(sprint.endDate).getTime()
    const now = new Date().getTime()
    const diff = end - now
    if (diff <= 0) return 0
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  // Rendu du graphique SVG du Burndown Chart
  const renderBurndownSvg = () => {
    if (!burndownData || !burndownData.data || burndownData.data.length === 0) {
      return (
        <div className="empty-chart-state">
          <p>Aucune donnée disponible pour dessiner le Burndown chart.</p>
        </div>
      )
    }

    const chartWidth = 600
    const chartHeight = 300
    const paddingLeft = 50
    const paddingRight = 30
    const paddingTop = 20
    const paddingBottom = 40

    const graphWidth = chartWidth - paddingLeft - paddingRight
    const graphHeight = chartHeight - paddingTop - paddingBottom

    const totalPoints = burndownData.totalPoints || 0
    const pointsList = burndownData.data.map((d: any) => d.real)
    const idealList = burndownData.data.map((d: any) => d.ideal)
    const datesList = burndownData.data.map((d: any) => d.date)

    const maxVal = Math.max(totalPoints, 1)

    // Coordonnées X & Y
    const getX = (index: number) => paddingLeft + (index / (pointsList.length - 1 || 1)) * graphWidth
    const getY = (val: number) => paddingTop + graphHeight - (val / maxVal) * graphHeight

    // Construction des chaînes de points pour les lignes
    let realPath = ''
    let idealPath = ''

    pointsList.forEach((val: number, i: number) => {
      const x = getX(i)
      const y = getY(val)
      if (i === 0) realPath += `M ${x} ${y}`
      else realPath += ` L ${x} ${y}`
    })

    idealList.forEach((val: number, i: number) => {
      const x = getX(i)
      const y = getY(val)
      if (i === 0) idealPath += `M ${x} ${y}`
      else idealPath += ` L ${x} ${y}`
    })

    // Dégradé de fond pour la courbe réelle
    const realAreaPath = `${realPath} L ${getX(pointsList.length - 1)} ${getY(0)} L ${getX(0)} ${getY(0)} Z`

    return (
      <div className="svg-chart-container">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="burndown-svg">
          <defs>
            <linearGradient id="realGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Quadrillage Y */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const val = Math.round(maxVal * ratio)
            const y = getY(val)
            return (
              <g key={i} className="grid-group">
                <line x1={paddingLeft} y1={y} x2={chartWidth - paddingRight} y2={y} className="chart-grid-line" />
                <text x={paddingLeft - 10} y={y + 4} className="chart-axis-text chart-axis-text--y">{val}</text>
              </g>
            )
          })}

          {/* Ligne Idéale (pointillée) */}
          <path d={idealPath} className="chart-line-ideal" />

          {/* Remplissage de gradient sous la courbe Réelle */}
          {realPath && <path d={realAreaPath} fill="url(#realGlow)" />}

          {/* Ligne Réelle */}
          <path d={realPath} className="chart-line-real" />

          {/* Points Réels */}
          {pointsList.map((val: number, i: number) => {
            const x = getX(i)
            const y = getY(val)
            const dateObj = new Date(datesList[i])
            const dayNum = dateObj.getDate()
            const monthStr = dateObj.toLocaleDateString('fr-FR', { month: 'short' })
            return (
              <g key={i} className="chart-point-group">
                <circle cx={x} cy={y} r="5" className="chart-point-circle" />
                <circle cx={x} cy={y} r="8" className="chart-point-pulse" />
                {/* Labels de l'axe X (filtrés pour ne pas surcharger) */}
                {(i === 0 || i === pointsList.length - 1 || pointsList.length < 10 || i % Math.ceil(pointsList.length / 5) === 0) && (
                  <text x={x} y={paddingTop + graphHeight + 20} className="chart-axis-text chart-axis-text--x">
                    {`${dayNum} ${monthStr}`}
                  </text>
                )}
                {/* Infobulle de valeur */}
                <title>{`${datesList[i]} : ${val} SP restants (Idéal : ${idealList[i]} SP)`}</title>
              </g>
            )
          })}
        </svg>
        <div className="chart-legend">
          <div className="legend-item">
            <span className="legend-indicator legend-indicator--ideal"></span>
            <span>Burndown Idéal</span>
          </div>
          <div className="legend-item">
            <span className="legend-indicator legend-indicator--real"></span>
            <span>Reste à faire Réel</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="agile-view-container">
      {/* Header Agile */}
      <div className="agile-header glass-panel">
        <div className="agile-header-title-container">
          <Sparkles className="agile-icon-sparkle" size={24} />
          <div>
            <h1 className="agile-title">Agile Workspace Hub</h1>
            <p className="agile-subtitle">Planification intelligente, sprints fluides & graphiques de burndown</p>
          </div>
        </div>

        {/* Workspace selector & controls */}
        <div className="agile-header-controls">
          <div className="control-group">
            <label className="control-label">Espace Actif :</label>
            <select
              value={activeWorkspaceId}
              onChange={(e) => setActiveWorkspaceId(e.target.value)}
              className="agile-select"
            >
              {workspaces.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <button onClick={() => loadWorkspaceAgileData()} className="btn-secondary btn-icon" title="Rafraîchir les données">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="agile-tabs-switcher glass-panel">
        <button
          onClick={() => setSubTab('planning')}
          className={`tab-btn ${activeTab === 'planning' ? 'tab-btn--active' : ''}`}
        >
          <ListTodo size={16} /> Planning du Backlog
        </button>
        <button
          onClick={() => setSubTab('dashboard')}
          className={`tab-btn ${activeTab === 'dashboard' ? 'tab-btn--active' : ''}`}
        >
          <BarChart2 size={16} /> Burndown & Vélocité
        </button>
      </div>

      {/* RENDER ACTIVE TAB */}
      {activeTab === 'planning' ? (
        <div className="planning-grid">
          {/* LEFT: BACKLOG COLUMN */}
          <div className="planning-column glass-panel">
            <div className="column-header">
              <div className="column-header-title">
                <Clipboard size={18} />
                <h2>Backlog de l'Espace</h2>
              </div>
              <span className="badge-count">{backlogTasks.length} tâches</span>
            </div>

            <div className="task-list">
              {backlogTasks.length === 0 ? (
                <div className="empty-column-state">
                  <p>Aucune tâche dans le backlog.</p>
                  <p className="subtext">Toutes les tâches actives de vos projets sont planifiées dans des sprints ou terminées.</p>
                </div>
              ) : (
                backlogTasks.map(task => (
                  <div key={task.id} className="task-agile-card glass-panel">
                    <div className="task-card-header">
                      <span className="project-badge">{task.projectName}</span>
                      <div className="story-point-container">
                        {editingTaskId === task.id ? (
                          <div className="sp-edit-form">
                            <input
                              type="number"
                              value={editingPoints}
                              onChange={(e) => setEditingPoints(e.target.value)}
                              className="sp-input"
                              min="0"
                              autoFocus
                            />
                            <button onClick={() => handleSaveStoryPoints(task.id)} className="btn-save-sp">
                              <Check size={12} />
                            </button>
                          </div>
                        ) : (
                          <span
                            className="story-points-badge"
                            onClick={() => {
                              setEditingTaskId(task.id)
                              setEditingPoints(String(task.storyPoints || 0))
                            }}
                            title="Modifier les story points"
                          >
                            {task.storyPoints !== null && task.storyPoints !== undefined ? `${task.storyPoints} SP` : '0 SP'}
                          </span>
                        )}
                      </div>
                    </div>
                    <h3 className="task-card-title">{task.title}</h3>
                    <div className="task-card-actions">
                      <select
                        onChange={(e) => handleTaskSprintChange(task.id, e.target.value)}
                        defaultValue=""
                        className="sprint-assign-select"
                      >
                        <option value="" disabled>Planifier dans...</option>
                        {sprints.filter(s => s.status !== 'COMPLETED').map(s => (
                          <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* RIGHT: SPRINTS COLUMN */}
          <div className="planning-column sprints-column glass-panel">
            <div className="column-header">
              <div className="column-header-title">
                <Calendar size={18} />
                <h2>Sprints Planifiés / Actifs</h2>
              </div>
              <button onClick={() => setShowCreateModal(true)} className="btn-primary btn-sm btn-icon">
                <Plus size={16} /> Nouveau Sprint
              </button>
            </div>

            <div className="sprint-list">
              {sprints.length === 0 ? (
                <div className="empty-column-state">
                  <p>Aucun sprint configuré.</p>
                  <p className="subtext">Créez votre premier sprint pour commencer à planifier.</p>
                </div>
              ) : (
                sprints.map(sprint => {
                  const sprintTasks = allWorkspaceTasks.filter(t => t.sprintId === sprint.id)
                  const sprintPoints = sprintTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0)
                  const completedSprintPoints = sprintTasks
                    .filter(t => t.status === 'DONE')
                    .reduce((sum, t) => sum + (t.storyPoints || 0), 0)

                  return (
                    <div key={sprint.id} className={`sprint-card glass-panel sprint-card--${sprint.status.toLowerCase()}`}>
                      <div className="sprint-card-header">
                        <div>
                          <h3 className="sprint-card-name">{sprint.name}</h3>
                          <span className={`sprint-status-badge badge--${sprint.status.toLowerCase()}`}>
                            {sprint.status === 'ACTIVE' ? 'Actif' : sprint.status === 'COMPLETED' ? 'Terminé' : 'Planifié'}
                          </span>
                        </div>
                        <div className="sprint-points-summary">
                          <span className="points-total">{completedSprintPoints} / {sprintPoints} SP</span>
                        </div>
                      </div>

                      <p className="sprint-card-dates">
                        Du {new Date(sprint.startDate).toLocaleDateString()} au {new Date(sprint.endDate).toLocaleDateString()}
                      </p>

                      {/* Task list inside Sprint */}
                      <div className="sprint-task-list">
                        {sprintTasks.length === 0 ? (
                          <p className="empty-sprint-tasks">Aucune tâche planifiée dans ce sprint.</p>
                        ) : (
                          sprintTasks.map(task => (
                            <div key={task.id} className="sprint-task-item">
                              <div className="task-item-left">
                                <span className={`status-dot status-dot--${task.status.toLowerCase()}`}></span>
                                <span className="task-item-title">{task.title}</span>
                              </div>
                              <div className="task-item-right">
                                <span className="task-item-sp">{task.storyPoints || 0} SP</span>
                                <button
                                  onClick={() => handleTaskSprintChange(task.id, null)}
                                  className="btn-remove-task"
                                  title="Retirer du sprint (remettre au backlog)"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Action buttons based on status */}
                      <div className="sprint-card-actions">
                        {sprint.status === 'PLANNED' && (
                          <button
                            onClick={() => handleUpdateSprintStatus(sprint.id, 'ACTIVE')}
                            className="btn-success btn-sm btn-icon"
                          >
                            <Play size={14} /> Démarrer le Sprint
                          </button>
                        )}
                        {sprint.status === 'ACTIVE' && (
                          <button
                            onClick={() => handleUpdateSprintStatus(sprint.id, 'COMPLETED')}
                            className="btn-danger btn-sm btn-icon"
                          >
                            <Square size={14} /> Clôturer le Sprint
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      ) : (
        /* SPRINT DASHBOARD & BURNDOWN */
        <div className="dashboard-grid-agile">
          {/* TOP KPIs PANEL */}
          <div className="agile-kpis-panel glass-panel">
            <div className="kpi-card">
              <Award className="kpi-icon" size={24} />
              <div className="kpi-info">
                <span className="kpi-label">Vélocité Moyenne</span>
                <span className="kpi-value">{velocity} SP</span>
              </div>
            </div>

            {selectedSprint && (
              <>
                <div className="kpi-card">
                  <Calendar className="kpi-icon" size={24} />
                  <div className="kpi-info">
                    <span className="kpi-label">Jours Restants</span>
                    <span className="kpi-value">{getDaysRemaining(selectedSprint)} jours</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <BarChart2 className="kpi-icon" size={24} />
                  <div className="kpi-info">
                    <span className="kpi-label">Tâches Complétées</span>
                    <span className="kpi-value">
                      {currentSprintTasks.filter(t => t.status === 'DONE').length} / {currentSprintTasks.length}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* MAIN GRAPH & SIDE SPRINT TABS */}
          <div className="dashboard-chart-layout">
            {/* SIDE SPRINT PICKER */}
            <div className="sprint-picker-panel glass-panel">
              <h3>Sélectionner un Sprint</h3>
              <div className="picker-list">
                {sprints.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSprintId(s.id)}
                    className={`picker-btn ${selectedSprintId === s.id ? 'picker-btn--active' : ''}`}
                  >
                    <span className="picker-btn-name">{s.name}</span>
                    <span className={`picker-btn-status picker-btn-status--${s.status.toLowerCase()}`}>
                      {s.status === 'ACTIVE' ? 'Actif' : s.status === 'COMPLETED' ? 'Terminé' : 'Planifié'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* CHART DISPLAY */}
            <div className="chart-display-panel glass-panel">
              <div className="chart-display-header">
                <h2>Burndown Chart : {selectedSprint?.name || 'Aucun sprint sélectionné'}</h2>
                {selectedSprint && (
                  <span className="chart-date-range">
                    {new Date(selectedSprint.startDate).toLocaleDateString()} - {new Date(selectedSprint.endDate).toLocaleDateString()}
                  </span>
                )}
              </div>
              {renderBurndownSvg()}
            </div>
          </div>
        </div>
      )}

      {/* CREATE SPRINT MODAL */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-content glass-panel">
            <div className="modal-header">
              <h2>Créer un Nouveau Sprint</h2>
              <button onClick={() => setShowCreateModal(false)} className="modal-close-btn">×</button>
            </div>
            <form onSubmit={handleCreateSprint} className="modal-form">
              <div className="form-group">
                <label>Nom du Sprint</label>
                <input
                  type="text"
                  placeholder="Ex: Sprint 1 - Core Backend"
                  value={newSprintName}
                  onChange={(e) => setNewSprintName(e.target.value)}
                  className="agile-input"
                  required
                />
              </div>
              <div className="form-group-row">
                <div className="form-group">
                  <label>Date de Début</label>
                  <input
                    type="date"
                    value={newSprintStart}
                    onChange={(e) => setNewSprintStart(e.target.value)}
                    className="agile-input"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Date de Fin</label>
                  <input
                    type="date"
                    value={newSprintEnd}
                    onChange={(e) => setNewSprintEnd(e.target.value)}
                    className="agile-input"
                    required
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">
                  Annuler
                </button>
                <button type="submit" className="btn-primary">
                  Créer le Sprint
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
