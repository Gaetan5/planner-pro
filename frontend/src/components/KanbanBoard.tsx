import React, { useState } from 'react'
import { useApp, Task, Project } from '../context/AppContext'
import { Plus, Trash2, Play, Square, FolderPlus, Tag } from 'lucide-react'

export const KanbanBoard: React.FC = () => {
  const {
    projects, createTask, updateTask, deleteTask, createProject, deleteProject, startTimer, activeTimer, stopTimer
  } = useApp()

  const [selectedProjId, setSelectedProjId] = useState<string>(projects[0]?.id || '')
  const [showNewTaskForm, setShowNewTaskForm] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskPriority, setTaskPriority] = useState('MEDIUM')

  const [showNewProjForm, setShowNewProjForm] = useState(false)
  const [projName, setProjName] = useState('')
  const [projDesc, setProjDesc] = useState('')

  const activeProject = projects.find(p => p.id === selectedProjId) || projects[0]

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskTitle.trim() || !activeProject) return
    createTask(activeProject.id, taskTitle, taskDesc, taskPriority)
    setTaskTitle('')
    setTaskDesc('')
    setTaskPriority('MEDIUM')
    setShowNewTaskForm(false)
  }

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault()
    if (!projName.trim()) return
    createProject(projName, projDesc)
    setProjName('')
    setProjDesc('')
    setShowNewProjForm(false)
  }

  const moveTaskStatus = (taskId: string, currentStatus: string) => {
    let nextStatus: Task['status'] = 'TODO'
    if (currentStatus === 'TODO') nextStatus = 'IN_PROGRESS'
    else if (currentStatus === 'IN_PROGRESS') nextStatus = 'DONE'
    else if (currentStatus === 'DONE') nextStatus = 'TODO'
    updateTask(taskId, { status: nextStatus })
  }

  const columns: { title: string; status: Task['status']; color: string }[] = [
    { title: 'À faire', status: 'TODO', color: 'var(--text-muted)' },
    { title: 'En cours', status: 'IN_PROGRESS', color: 'var(--accent-primary)' },
    { title: 'Terminé', status: 'DONE', color: 'var(--color-success)' }
  ]

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'HIGH': return 'var(--color-error)'
      case 'MEDIUM': return 'var(--color-warning)'
      default: return 'var(--color-info)'
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '24px', flex: 1, minHeight: 0 }}>
      {/* Sidebar de projets */}
      <aside className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Projets</h3>
          <button onClick={() => setShowNewProjForm(!showNewProjForm)} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer' }}>
            <FolderPlus size={18} />
          </button>
        </div>

        {showNewProjForm && (
          <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', background: 'var(--glass-highlight)', borderRadius: 'var(--radius-sm)' }}>
            <input
              type="text"
              placeholder="Nom du projet"
              value={projName}
              onChange={e => setProjName(e.target.value)}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: '#fff', padding: '6px', fontSize: '12px', outline: 'none' }}
              required
            />
            <button type="submit" className="btn-primary" style={{ padding: '6px', fontSize: '11px', justifyContent: 'center' }}>Créer</button>
          </form>
        )}

        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {projects.map(proj => (
            <li
              key={proj.id}
              onClick={() => setSelectedProjId(proj.id)}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                background: (activeProject?.id === proj.id) ? 'var(--glass-highlight)' : 'none',
                color: (activeProject?.id === proj.id) ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: '14px',
                fontWeight: (activeProject?.id === proj.id) ? 600 : 400,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span>{proj.name}</span>
              {proj.name !== 'Inbox' && (
                <Trash2 size={13} style={{ cursor: 'pointer', opacity: 0.5 }} onClick={(e) => { e.stopPropagation(); deleteProject(proj.id) }} />
              )}
            </li>
          ))}
        </ul>
      </aside>

      {/* Colonnes Kanban */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minHeight: 0 }}>
        {/* En-tête de projet */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: 700 }}>{activeProject?.name || 'Sélectionnez un projet'}</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{activeProject?.description || 'Gestion des tâches'}</p>
          </div>

          <button onClick={() => setShowNewTaskForm(true)} className="btn-primary">
            <Plus size={18} /> Ajouter une tâche
          </button>
        </div>

        {showNewTaskForm && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <form onSubmit={handleCreateTask} className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3>Nouvelle Tâche</h3>
              <input
                type="text"
                placeholder="Titre de la tâche"
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: '#fff', padding: '10px', borderRadius: 'var(--radius-sm)', outline: 'none' }}
                required
              />
              <textarea
                placeholder="Description (optionnel)"
                value={taskDesc}
                onChange={e => setTaskDesc(e.target.value)}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: '#fff', padding: '10px', borderRadius: 'var(--radius-sm)', outline: 'none', minHeight: '80px', fontFamily: 'inherit' }}
              />
              <select
                value={taskPriority}
                onChange={e => setTaskPriority(e.target.value)}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', color: '#fff', padding: '10px', borderRadius: 'var(--radius-sm)', outline: 'none' }}
              >
                <option value="LOW">Priorité Basse</option>
                <option value="MEDIUM">Priorité Moyenne</option>
                <option value="HIGH">Priorité Haute</option>
              </select>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button type="button" onClick={() => setShowNewTaskForm(false)} className="glass-panel" style={{ padding: '8px 16px', background: 'none', border: '1px solid var(--glass-border)', color: '#fff', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}>Annuler</button>
                <button type="submit" className="btn-primary">Créer</button>
              </div>
            </form>
          </div>
        )}

        {/* Board Columns Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', flex: 1, minHeight: 0 }}>
          {columns.map(col => {
            const colTasks = activeProject?.tasks?.filter(t => t.status === col.status) || []

            return (
              <div key={col.status} className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255, 255, 255, 0.01)', minHeight: 0 }}>
                {/* Header colonne */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: col.color }}></span>
                    {col.title}
                  </h4>
                  <span style={{ fontSize: '11px', background: 'var(--glass-highlight)', padding: '2px 8px', borderRadius: '10px', color: 'var(--text-secondary)' }}>
                    {colTasks.length}
                  </span>
                </div>

                {/* Tasks List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                  {colTasks.map(task => {
                    const isTrackingThis = activeTimer?.taskId === task.id

                    return (
                      <div
                        key={task.id}
                        className="glass-panel"
                        onClick={() => moveTaskStatus(task.id, task.status)}
                        style={{
                          padding: '14px',
                          background: 'var(--glass-highlight)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          position: 'relative'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: getPriorityColor(task.priority),
                            background: 'rgba(255,255,255,0.02)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: `1px solid ${getPriorityColor(task.priority)}40`
                          }}>
                            {task.priority}
                          </span>

                          <div style={{ display: 'flex', gap: '8px' }} onClick={e => e.stopPropagation()}>
                            {isTrackingThis ? (
                              <button onClick={stopTimer} style={{ background: 'var(--color-error)', border: 'none', color: '#fff', borderRadius: '50%', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                <Square size={12} fill="#fff" />
                              </button>
                            ) : (
                              <button onClick={() => startTimer(task.id)} style={{ background: 'var(--accent-gradient)', border: 'none', color: '#fff', borderRadius: '50%', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                <Play size={12} fill="#fff" style={{ marginLeft: '2px' }} />
                              </button>
                            )}
                            <button onClick={() => deleteTask(task.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }} onMouseOver={e => e.currentTarget.style.color = 'var(--color-error)'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <h5 style={{ fontSize: '14px', fontWeight: 600, textDecoration: col.status === 'DONE' ? 'line-through' : 'none', opacity: col.status === 'DONE' ? 0.6 : 1 }}>
                          {task.title}
                        </h5>

                        {task.description && (
                          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {task.description}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
