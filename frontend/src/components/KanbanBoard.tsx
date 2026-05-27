import React, { useState } from 'react'
import { useApp, Task } from '../context/AppContext'
import { Plus, Trash2, Play, Square, FolderPlus } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useDraggable,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import './KanbanBoard.css'

/* ======== Sub-components for DnD ======== */

function DroppableColumn({
  status,
  isOver,
  children,
}: {
  status: string
  isOver: boolean
  children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={`kanban-tasks-list ${isOver ? 'kanban-tasks-list--over' : ''}`}
    >
      {children}
    </div>
  )
}

function DraggableCard({
  task,
  col,
  activeTimer,
  startTimer,
  stopTimer,
  deleteTask,
  moveTaskStatus,
  getPriorityClass,
}: {
  task: Task
  col: { status: string }
  activeTimer: any
  startTimer: (id: string) => void
  stopTimer: () => void
  deleteTask: (id: string) => void
  moveTaskStatus: (id: string, status: string) => void
  getPriorityClass: (priority: string) => string
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  const isTrackingThis = activeTimer?.taskId === task.id

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`glass-panel kanban-card ${isDragging ? 'kanban-card--dragging' : ''}`}
      onClick={() => moveTaskStatus(task.id, task.status)}
    >
      <div className="kanban-card-header">
        <span className={`kanban-card-priority ${getPriorityClass(task.priority)}`}>
          {task.priority}
        </span>

        <div className="kanban-card-controls" onClick={e => e.stopPropagation()}>
          {isTrackingThis ? (
            <button
              onClick={stopTimer}
              className="kanban-card-btn-timer kanban-card-btn-timer--stop"
            >
              <Square size={12} fill="#fff" />
            </button>
          ) : (
            <button
              onClick={() => startTimer(task.id)}
              className="kanban-card-btn-timer kanban-card-btn-timer--start"
            >
              <Play size={12} fill="#fff" style={{ marginLeft: '2px' }} />
            </button>
          )}
          <button
            onClick={() => deleteTask(task.id)}
            className="kanban-card-btn-delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <h5
        className={`kanban-card-title ${col.status === 'DONE' ? 'kanban-card-title--done' : ''}`}
      >
        {task.title}
      </h5>

      {task.description && (
        <p className="kanban-card-desc">{task.description}</p>
      )}
    </div>
  )
}

/* ======== Main Component ======== */

export const KanbanBoard: React.FC = () => {
  const {
    projects,
    createTask,
    updateTask,
    deleteTask,
    createProject,
    deleteProject,
    startTimer,
    activeTimer,
    stopTimer,
  } = useApp()

  const [selectedProjId, setSelectedProjId] = useState<string>(projects[0]?.id || '')
  const [showNewTaskForm, setShowNewTaskForm] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskPriority, setTaskPriority] = useState('MEDIUM')

  const [showNewProjForm, setShowNewProjForm] = useState(false)
  const [projName, setProjName] = useState('')
  const [projDesc, setProjDesc] = useState('')

  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null)
  const [overColumnId, setOverColumnId] = useState<string | null>(null)

  const activeProject = projects.find(p => p.id === selectedProjId) || projects[0]

  // DnD sensor with activation constraint to distinguish click from drag
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

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

  /* DnD Handlers */
  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined
    setActiveDragTask(task || null)
  }

  const handleDragOver = (event: any) => {
    setOverColumnId(event.over?.id as string || null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragTask(null)
    setOverColumnId(null)

    if (!over) return

    const taskId = active.id as string
    const newStatus = over.id as Task['status']
    const task = active.data.current?.task as Task | undefined

    // Only update if status actually changes
    if (task && task.status !== newStatus) {
      updateTask(taskId, { status: newStatus })
    }
  }

  const columns: { title: string; status: Task['status']; color: string }[] = [
    { title: 'À faire', status: 'TODO', color: 'var(--text-muted)' },
    { title: 'En cours', status: 'IN_PROGRESS', color: 'var(--accent-primary)' },
    { title: 'Terminé', status: 'DONE', color: 'var(--color-success)' },
  ]

  const getPriorityClass = (priority: string) => {
    switch (priority) {
      case 'HIGH':
        return 'badge--priority-high'
      case 'MEDIUM':
        return 'badge--priority-medium'
      default:
        return 'badge--priority-low'
    }
  }

  return (
    <div className="kanban-layout">
      {/* Sidebar de projets */}
      <aside className="glass-panel kanban-sidebar">
        <div className="kanban-sidebar-header">
          <h3 className="kanban-sidebar-title">Projets</h3>
          <button
            onClick={() => setShowNewProjForm(!showNewProjForm)}
            className="kanban-new-project-btn"
          >
            <FolderPlus size={18} />
          </button>
        </div>

        {showNewProjForm && (
          <form onSubmit={handleCreateProject} className="kanban-new-project-form">
            <input
              type="text"
              placeholder="Nom du projet"
              value={projName}
              onChange={e => setProjName(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary">
              Créer
            </button>
          </form>
        )}

        <ul className="kanban-project-list">
          {projects.map(proj => (
            <li
              key={proj.id}
              onClick={() => setSelectedProjId(proj.id)}
              className={`kanban-project-item ${activeProject?.id === proj.id ? 'kanban-project-item--active' : ''}`}
            >
              <span>{proj.name}</span>
              {proj.name !== 'Inbox' && (
                <button
                  className="kanban-project-delete-btn"
                  onClick={e => {
                    e.stopPropagation()
                    deleteProject(proj.id)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>

      {/* Colonnes Kanban */}
      <div className="kanban-main">
        {/* En-tête de projet */}
        <div className="kanban-header">
          <div className="kanban-project-info">
            <h2 className="kanban-project-title">
              {activeProject?.name || 'Sélectionnez un projet'}
            </h2>
            <p className="kanban-project-desc">
              {activeProject?.description || 'Gestion des tâches'}
            </p>
          </div>

          <button onClick={() => setShowNewTaskForm(true)} className="btn-primary">
            <Plus size={18} /> Ajouter une tâche
          </button>
        </div>

        {/* Modal de création de tâche */}
        {showNewTaskForm && (
          <div className="modal-overlay" onClick={() => setShowNewTaskForm(false)}>
            <form
              onSubmit={handleCreateTask}
              className="glass-panel modal-content task-modal-form"
              onClick={e => e.stopPropagation()}
            >
              <h3>Nouvelle Tâche</h3>
              <input
                type="text"
                placeholder="Titre de la tâche"
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                className="form-input"
                required
              />
              <textarea
                placeholder="Description (optionnel)"
                value={taskDesc}
                onChange={e => setTaskDesc(e.target.value)}
                className="form-textarea"
                rows={3}
              />
              <select
                value={taskPriority}
                onChange={e => setTaskPriority(e.target.value)}
                className="form-select"
              >
                <option value="LOW">Priorité Basse</option>
                <option value="MEDIUM">Priorité Moyenne</option>
                <option value="HIGH">Priorité Haute</option>
              </select>
              <div className="kanban-card-controls" style={{ justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewTaskForm(false)}
                  className="btn-ghost"
                  style={{ padding: '8px 16px', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)' }}
                >
                  Annuler
                </button>
                <button type="submit" className="btn-primary">
                  Créer
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Board Columns Grid with DnD */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="kanban-columns">
            {columns.map(col => {
              const colTasks =
                activeProject?.tasks?.filter(t => t.status === col.status) || []

              return (
                <div key={col.status} className="glass-panel kanban-column">
                  {/* Header colonne */}
                  <div className="kanban-column-header">
                    <h4 className="kanban-column-title">
                      <span
                        className="kanban-column-color"
                        style={{ backgroundColor: col.color }}
                      ></span>
                      {col.title}
                    </h4>
                    <span className="kanban-column-count">{colTasks.length}</span>
                  </div>

                  {/* Droppable Tasks List */}
                  <DroppableColumn
                    status={col.status}
                    isOver={overColumnId === col.status}
                  >
                    {colTasks.map(task => (
                      <DraggableCard
                        key={task.id}
                        task={task}
                        col={col}
                        activeTimer={activeTimer}
                        startTimer={startTimer}
                        stopTimer={stopTimer}
                        deleteTask={deleteTask}
                        moveTaskStatus={moveTaskStatus}
                        getPriorityClass={getPriorityClass}
                      />
                    ))}
                  </DroppableColumn>
                </div>
              )
            })}
          </div>

          {/* Drag Overlay — Clone visuel de la carte en cours de drag */}
          <DragOverlay>
            {activeDragTask ? (
              <div className="glass-panel kanban-card dnd-drag-overlay">
                <div className="kanban-card-header">
                  <span className={`kanban-card-priority ${getPriorityClass(activeDragTask.priority)}`}>
                    {activeDragTask.priority}
                  </span>
                </div>
                <h5 className="kanban-card-title">{activeDragTask.title}</h5>
                {activeDragTask.description && (
                  <p className="kanban-card-desc">{activeDragTask.description}</p>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  )
}
