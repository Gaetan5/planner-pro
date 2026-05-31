import React, { useState } from 'react'
import { useApp, Task } from '../context/AppContext'
import { Plus, Trash2, Play, Square, FolderPlus, MessageSquare } from 'lucide-react'
import { TaskCommentsPanel } from './TaskCommentsPanel'
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
  onOpenComments,
}: {
  task: Task
  col: { status: string }
  activeTimer: any
  startTimer: (id: string) => void
  stopTimer: () => void
  deleteTask: (id: string) => void
  moveTaskStatus: (id: string, status: string) => void
  getPriorityClass: (priority: string) => string
  onOpenComments: (task: Task) => void
}) {
  const { isReadOnly } = useApp()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: isReadOnly,
  })

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  const isTrackingThis = activeTimer?.taskId === task.id
  const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null
  const estimate = task.estimatedMinutes ? `${Math.round(task.estimatedMinutes / 60 * 10) / 10}h` : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(isReadOnly ? {} : listeners)}
      {...(isReadOnly ? {} : attributes)}
      className={`glass-panel kanban-card ${isDragging ? 'kanban-card--dragging' : ''} ${isReadOnly ? 'kanban-card--readonly' : ''}`}
      onClick={() => !isReadOnly && moveTaskStatus(task.id, task.status)}
    >
      <div className="kanban-card-header">
        <span className={`kanban-card-priority ${getPriorityClass(task.priority)}`}>
          {task.priority}
        </span>

        <div className="kanban-card-controls" onClick={e => e.stopPropagation()}>
          {!isReadOnly && (
            isTrackingThis ? (
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
            )
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpenComments(task)
            }}
            className="kanban-card-btn-comments"
            title="Commentaires"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', borderRadius: '4px', transition: 'all 0.2s', marginRight: '4px' }}
          >
            <MessageSquare size={14} />
          </button>
          {!isReadOnly && (
            <button
              onClick={() => deleteTask(task.id)}
              className="kanban-card-btn-delete"
            >
              <Trash2 size={14} />
            </button>
          )}
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

      <div className="kanban-card-meta">
        {dueDate && <span>Échéance {dueDate}</span>}
        {estimate && <span>Estimé {estimate}</span>}
        {typeof task.progress === 'number' && <span>{task.progress}%</span>}
      </div>

      {task.dependencies && task.dependencies.length > 0 && (
        <div className="kanban-card-dependencies" style={{ marginTop: 'var(--space-xs)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {task.dependencies.map((dep) => (
            <span key={dep.id} style={{ fontSize: 'var(--font-2xs)', color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '2px' }}>
              🔗 Bloqué par : {dep.dependsOnTask?.title || 'Tâche'}
            </span>
          ))}
        </div>
      )}

      {task.assignees && task.assignees.length > 0 && (
        <div className="kanban-card-assignees">
          {task.assignees.map((assignee) => (
            <span key={assignee.id} className="kanban-card-assignee">
              {(assignee.user.name || assignee.user.email).slice(0, 2).toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ======== Main Component ======== */

export const KanbanBoard: React.FC = () => {
  const {
    projects,
    workspaceMembers,
    createTask,
    updateTask,
    deleteTask,
    createProject,
    deleteProject,
    startTimer,
    activeTimer,
    stopTimer,
    addTaskDependency,
    isReadOnly,
  } = useApp()

  const [selectedProjId, setSelectedProjId] = useState<string>(projects[0]?.id || '')
  const [showNewTaskForm, setShowNewTaskForm] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskPriority, setTaskPriority] = useState('MEDIUM')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [taskEstimateHours, setTaskEstimateHours] = useState('')
  const [taskProgress, setTaskProgress] = useState('0')
  const [taskLabels, setTaskLabels] = useState('')
  const [taskAssigneeIds, setTaskAssigneeIds] = useState<string[]>([])
  const [taskDependencyId, setTaskDependencyId] = useState('')

  const [showNewProjForm, setShowNewProjForm] = useState(false)
  const [projName, setProjName] = useState('')
  const [projDesc, setProjDesc] = useState('')

  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null)
  const [overColumnId, setOverColumnId] = useState<string | null>(null)
  const [commentingTask, setCommentingTask] = useState<Task | null>(null)

  const activeProject = projects.find(p => p.id === selectedProjId) || projects[0]

  // DnD sensor with activation constraint to distinguish click from drag
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskTitle.trim() || !activeProject) return
    const createdTask = await createTask(activeProject.id, taskTitle, taskDesc, taskPriority, {
      dueDate: taskDueDate ? new Date(taskDueDate).toISOString() : undefined,
      estimatedMinutes: taskEstimateHours ? Math.round(Number(taskEstimateHours) * 60) : undefined,
      progress: Number(taskProgress) || 0,
      labels: taskLabels || undefined,
      assigneeIds: taskAssigneeIds,
    })

    if (createdTask && taskDependencyId) {
      await addTaskDependency(createdTask.id, taskDependencyId)
    }

    setTaskTitle('')
    setTaskDesc('')
    setTaskPriority('MEDIUM')
    setTaskDueDate('')
    setTaskEstimateHours('')
    setTaskProgress('0')
    setTaskLabels('')
    setTaskAssigneeIds([])
    setTaskDependencyId('')
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
          {!isReadOnly && (
            <button
              onClick={() => setShowNewProjForm(!showNewProjForm)}
              className="kanban-new-project-btn"
            >
              <FolderPlus size={18} />
            </button>
          )}
        </div>

        {showNewProjForm && !isReadOnly && (
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
              {proj.name !== 'Inbox' && !isReadOnly && (
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

          {!isReadOnly && (
            <button onClick={() => setShowNewTaskForm(true)} className="btn-primary">
              <Plus size={18} /> Ajouter une tâche
            </button>
          )}
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
              <div className="task-modal-grid">
                <label>
                  Échéance
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={e => setTaskDueDate(e.target.value)}
                    className="form-input"
                  />
                </label>
                <label>
                  Estimation (h)
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={taskEstimateHours}
                    onChange={e => setTaskEstimateHours(e.target.value)}
                    className="form-input"
                  />
                </label>
                <label>
                  Avancement (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={taskProgress}
                    onChange={e => setTaskProgress(e.target.value)}
                    className="form-input"
                  />
                </label>
                <label>
                  Labels
                  <input
                    type="text"
                    placeholder="design, api, urgent"
                    value={taskLabels}
                    onChange={e => setTaskLabels(e.target.value)}
                    className="form-input"
                  />
                </label>
              </div>
              <label className="task-modal-assignees">
                Affectation
                <select
                  multiple
                  value={taskAssigneeIds}
                  onChange={e => setTaskAssigneeIds(Array.from(e.currentTarget.selectedOptions, option => option.value))}
                  className="form-select"
                >
                  {workspaceMembers.map((member) => (
                    <option key={member.user.id} value={member.user.id}>
                      {member.user.name || member.user.email} - {member.role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-modal-assignees" style={{ marginTop: '8px' }}>
                Dépendance (Bloqué par)
                <select
                  value={taskDependencyId}
                  onChange={e => setTaskDependencyId(e.target.value)}
                  className="form-select"
                >
                  <option value="">Aucune</option>
                  {activeProject?.tasks?.map((taskItem) => (
                    <option key={taskItem.id} value={taskItem.id}>
                      {taskItem.title}
                    </option>
                  ))}
                </select>
              </label>
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
                        onOpenComments={(task) => setCommentingTask(task)}
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

      {commentingTask && (
        <TaskCommentsPanel
          taskId={commentingTask.id}
          taskTitle={commentingTask.title}
          onClose={() => setCommentingTask(null)}
        />
      )}
    </div>
  )
}
