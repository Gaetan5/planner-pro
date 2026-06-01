import React, { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { io, Socket } from 'socket.io-client'

export interface TaskAssignee {
  id: string
  user: { id: string; name?: string; email: string }
}

export interface TaskDependency {
  id: string
  taskId: string
  dependsOnTaskId: string
  type: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH'
  dependsOnTask?: Task
}

export interface Task {
  id: string
  title: string
  description?: string
  status: 'TODO' | 'IN_PROGRESS' | 'DONE'
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  startDate?: string
  dueDate?: string
  estimatedMinutes?: number
  progress?: number
  labels?: string
  projectId: string
  project?: { name: string }
  assignees?: TaskAssignee[]
  dependencies?: TaskDependency[]
  dependents?: { id: string; task: Task }[]
  noteId?: string
  storyPoints?: number
  sprintId?: string
  completedAt?: string
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
  memberships?: WorkspaceMember[]
}

export interface Project {
  id: string
  name: string
  description?: string
  githubRepo?: string
  status?: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'AT_RISK' | 'DELIVERED' | 'CLOSED'
  startDate?: string
  dueDate?: string
  workspaceId?: string
  workspace?: Workspace
  milestones?: Milestone[]
  deliverables?: Deliverable[]
  deliveries?: DeliveryRecord[]
  tasks?: Task[]
}

export interface Note {
  id: string
  title: string
  content: string
  updatedAt: string
  tasks?: Task[]
}

export interface TimeBlock {
  id: string
  startTime: string
  endTime: string
  taskId: string
  task?: Task
}

export interface WorkspaceMember {
  id: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
  user: { id: string; name?: string; email: string }
}

export interface Sprint {
  id: string
  name: string
  startDate: string
  endDate: string
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED'
  workspaceId: string
  totalPoints?: number
  completedPoints?: number
  tasks?: Task[]
}

export interface Milestone {
  id: string
  name: string
  description?: string
  dueDate?: string
  completedAt?: string
  projectId: string
}

export interface Deliverable {
  id: string
  title: string
  description?: string
  status: 'DRAFT' | 'READY_FOR_REVIEW' | 'ACCEPTED' | 'DELIVERED'
  dueDate?: string
  acceptedAt?: string
  projectId: string
}

export interface DeliveryChecklistItem {
  id: string
  deliveryId: string
  title: string
  checked: boolean
}

export interface DeliveryRecord {
  id: string
  projectId: string
  status: 'DRAFT' | 'READY_FOR_ACCEPTANCE' | 'ACCEPTED' | 'REJECTED'
  summary?: string
  deliveredAt?: string
  acceptedAt?: string
  checklist?: DeliveryChecklistItem[]
}

export interface ResourceProfile {
  id: string
  workspaceId: string
  userId: string
  weeklyCapacityMinutes: number
  skills?: string
  costRateCents?: number
}

export interface ResourceCapacityReportItem {
  user: { id: string; name?: string; email: string }
  role: string
  profile?: ResourceProfile
  weeklyCapacityMinutes: number
  plannedMinutes: number
  estimatedOpenMinutes: number
  allocationPercent: number
  loadPercent: number
  overloaded: boolean
  conflicts: string[]
}

export type CreateTaskOptions = {
  startDate?: string
  dueDate?: string
  estimatedMinutes?: number
  progress?: number
  labels?: string
  assigneeIds?: string[]
  storyPoints?: number
  sprintId?: string
}
interface AppContextType {
  user: { id: string; name: string; email: string; token?: string } | null
  projects: Project[]
  notes: Note[]
  workspaces: Workspace[]
  workspaceMembers: WorkspaceMember[]
  resourceCapacity: ResourceCapacityReportItem[]
  timeBlocks: TimeBlock[]
  activeTimer: { id: string; startTime: string; taskId: string; task?: Task } | null
  activeTab: 'dashboard' | 'kanban' | 'calendar' | 'notes' | 'pomodoro' | 'governance' | 'resources' | 'agile' | 'gantt' | 'finances'
  isConnected: boolean
  login: (code: string) => Promise<void>
  logout: () => void
  mockLogin: (name: string) => Promise<void>
  setActiveTab: (tab: 'dashboard' | 'kanban' | 'calendar' | 'notes' | 'pomodoro' | 'governance' | 'resources' | 'agile' | 'gantt' | 'finances') => void
  createProject: (name: string, description?: string, workspaceId?: string, status?: string, startDate?: string, dueDate?: string) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>
  createTask: (projectId: string, title: string, description?: string, priority?: string, options?: CreateTaskOptions) => Promise<any>
  updateTask: (taskId: string, data: Partial<Task>) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  startTimer: (taskId: string) => void
  stopTimer: () => void
  saveNote: (title: string, content: string, noteId?: string) => Promise<void>
  deleteNote: (noteId: string) => Promise<void>
  createTimeBlock: (taskId: string, startTime: string, endTime: string) => Promise<void>
  updateTimeBlock: (timeBlockId: string, startTime: string, endTime: string) => Promise<void>
  deleteTimeBlock: (timeBlockId: string) => Promise<void>
  // Pomodoro
  pomodoroState: 'idle' | 'focus' | 'break'
  pomodoroTaskId: string | null
  pomodoroTimeLeft: number
  pomodoroSettings: { focusDuration: number; breakDuration: number }
  isPomodoroRunning: boolean
  setPomodoroSettings: (settings: { focusDuration: number; breakDuration: number }) => void
  startPomodoro: (taskId: string) => void
  pausePomodoro: () => void
  resumePomodoro: () => void
  resetPomodoro: () => void
  skipBreak: () => void
  // Thème
  theme: 'dark' | 'light'
  toggleTheme: () => void
  // Notifications
  requestNotificationPermission: () => Promise<void>
  sendBrowserNotification: (title: string, options?: NotificationOptions) => void
  scheduleReminder: (taskTitle: string, startTimeIso: string) => void
  // Professional features
  createMilestone: (projectId: string, name: string, description?: string, dueDate?: string) => Promise<void>
  completeMilestone: (milestoneId: string) => Promise<void>
  createDeliverable: (projectId: string, title: string, description?: string, status?: string, dueDate?: string) => Promise<void>
  updateDeliverableStatus: (deliverableId: string, status: string) => Promise<void>
  createDelivery: (projectId: string, summary?: string, checklist?: string[]) => Promise<void>
  updateDeliveryStatus: (deliveryId: string, status: string) => Promise<void>
  toggleDeliveryChecklistItem: (itemId: string) => Promise<void>
  addTaskDependency: (taskId: string, dependsOnTaskId: string, type?: string) => Promise<void>
  removeTaskDependency: (taskId: string, dependsOnTaskId: string) => Promise<void>
  getProjectCriticalPath: (projectId: string) => Promise<{ criticalTaskIds: string[], slacks: Record<string, number> } | null>
  updateResourceProfile: (userId: string, weeklyCapacityMinutes?: number, skills?: string, costRateCents?: number) => Promise<void>
  createResourceAllocation: (projectId: string, userId: string, allocationPercent: number, roleLabel?: string, startDate?: string, endDate?: string) => Promise<void>
  refreshData: () => Promise<void>
  // Invitations / Collaboration
  createInvitation: (workspaceId: string, email: string | null, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER', projectId?: string, durationDays?: number) => Promise<{ invitation: any; rawToken: string } | null>
  listInvitations: (workspaceId: string) => Promise<any[]>
  revokeInvitation: (invitationId: string) => Promise<void>
  checkInvitation: (token: string) => Promise<{ workspaceName: string; invitedByName: string; role: string }>
  acceptInvitation: (token: string) => Promise<{ workspaceId: string; message: string }>
  // Commentaires & Communication
  socket: Socket | null
  addComment: (taskId: string, content: string) => Promise<any>
  getComments: (taskId: string) => Promise<any[]>
  deleteComment: (commentId: string) => Promise<void>
  updateComment: (commentId: string, content: string) => Promise<any>
  parseAiCommand: (workspaceId: string, projectId: string | null, command: string) => Promise<any[]>
  executeAiActions: (workspaceId: string, projectId: string | null, actions: any[]) => Promise<{ success: boolean; executedCount: number }>
  parseAiVoiceCommand: (workspaceId: string, projectId: string | null, audioBlob: Blob) => Promise<{ transcription: string; actions: any[] }>
  parseAiImageCommand: (workspaceId: string, projectId: string | null, imageBlob: Blob) => Promise<any[]>
  getCopilotAlerts: (workspaceId: string) => Promise<any[]>
  getCopilotBriefing: (workspaceId: string, isMock?: boolean) => Promise<{ briefing: string }>
  // Intégrations & Synchronisation Réelle
  listIntegrations: (workspaceId: string) => Promise<any[]>
  createIntegration: (workspaceId: string, type: 'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK', name: string, url?: string, calendarId?: string) => Promise<any>
  toggleIntegration: (integrationId: string) => Promise<any>
  deleteIntegration: (integrationId: string) => Promise<any>
  exportToCalendar: (workspaceId: string, integrationId: string) => Promise<any>
  getCalendarConflicts: (workspaceId: string) => Promise<any[]>
  // Agile
  createSprint: (name: string, startDate: string, endDate: string, workspaceId: string) => Promise<void>
  updateSprintStatus: (sprintId: string, status: 'PLANNED' | 'ACTIVE' | 'COMPLETED') => Promise<void>
  associateTasksToSprint: (sprintId: string | null, taskIds: string[]) => Promise<void>
  getBurndownData: (sprintId: string) => Promise<any>
  getVelocityData: (workspaceId: string) => Promise<number>
  currentUserRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | null
  isReadOnly: boolean
}
const AppContext = createContext<AppContextType | undefined>(undefined)

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppContextType['user']>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([])
  const [resourceCapacity, setResourceCapacity] = useState<ResourceCapacityReportItem[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [activeTimer, setActiveTimer] = useState<AppContextType['activeTimer']>(null)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'kanban' | 'calendar' | 'notes' | 'pomodoro' | 'governance' | 'resources' | 'agile' | 'gantt' | 'finances'>('dashboard')
  const [isConnected, setIsConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)

  // Pomodoro States
  const [pomodoroState, setPomodoroState] = useState<'idle' | 'focus' | 'break'>('idle')
  const [pomodoroTaskId, setPomodoroTaskId] = useState<string | null>(null)
  const [pomodoroSettings, setPomodoroSettings] = useState({ focusDuration: 25, breakDuration: 5 })
  const [pomodoroTimeLeft, setPomodoroTimeLeft] = useState<number>(25 * 60)
  const [isPomodoroRunning, setIsPomodoroRunning] = useState(false)

  // Thème State
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('planner_theme') as 'dark' | 'light') || 'dark'
  )

  // Charger la session utilisateur au démarrage
  useEffect(() => {
    const savedUser = localStorage.getItem('planner_user')
    if (savedUser) {
      setUser(JSON.parse(savedUser))
    }
  }, [])

  // Helper pour générer les headers HTTP avec le token JWT
  const getHeaders = () => {
    return {
      'Content-Type': 'application/json',
      'Authorization': user?.token ? `Bearer ${user.token}` : ''
    }
  }

  // Gérer la connexion WebSocket et tester l'API Backend
  useEffect(() => {
    let activeSocket: any = null

    if (!user) {
      if (socket) {
        socket.disconnect()
        setSocket(null)
      }
      setIsConnected(false)
      return
    }

    const initConnection = async () => {
      try {
        const testRes = await fetch(`${BACKEND_URL}/projects`, {
          headers: getHeaders()
        })
        
        if (testRes.ok || testRes.status === 401) {
          setIsConnected(true)
          
          // Initialisation du WebSocket
          const newSocket = io(BACKEND_URL, {
            extraHeaders: {
              Authorization: user.token ? `Bearer ${user.token}` : ''
            }
          })
          activeSocket = newSocket
          setSocket(newSocket)

          const handleConnect = () => {
            console.log('Connecté au WebSocket backend')
          }
          const handleActiveTimerState = (state: any) => {
            setActiveTimer(state)
          }
          const handleTimerStarted = (log: any) => {
            setActiveTimer({
              id: log.id,
              startTime: log.startTime,
              taskId: log.taskId,
              task: log.task
            })
          }
          const handleTimerStopped = () => {
            setActiveTimer(null)
          }
          const handleTaskStatusChanged = () => {
            refreshData()
          }
          const handleTaskSchedulePropagated = (data: any) => {
            refreshData()
            sendBrowserNotification('Auto-Scheduling Activé', {
              body: `${data.impactedTaskIds?.length || 'Plusieurs'} tâche(s) ont été décalées par effet domino suite à un changement d'échéance.`
            })
          }
          const handleMentionNotification = (data: any) => {
            sendBrowserNotification('Nouvelle Mention !', {
              body: data.message || 'Vous avez été mentionné dans un commentaire.',
            })
            try {
              const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-500.wav')
              audio.volume = 0.5
              audio.play()
            } catch (e) {
              console.log('Impossible de jouer la notification sonore', e)
            }
          }

          newSocket.on('connect', handleConnect)
          newSocket.on('active-timer-state', handleActiveTimerState)
          newSocket.on('timer-started', handleTimerStarted)
          newSocket.on('timer-stopped', handleTimerStopped)
          newSocket.on('task-status-changed', handleTaskStatusChanged)
          newSocket.on('task-schedule-propagated', handleTaskSchedulePropagated)
          newSocket.on('mention-notification', handleMentionNotification)
        } else {
          setIsConnected(false)
        }
      } catch (err) {
        console.warn('Le serveur backend est injoignable.', err)
        setIsConnected(false)
      }
    }

    initConnection()

    return () => {
      if (activeSocket) {
        activeSocket.off('connect')
        activeSocket.off('active-timer-state')
        activeSocket.off('timer-started')
        activeSocket.off('timer-stopped')
        activeSocket.off('task-status-changed')
        activeSocket.off('task-schedule-propagated')
        activeSocket.off('mention-notification')
        activeSocket.disconnect()
      }
    }
  }, [user])

  // Charger les données réelles depuis le backend
  const refreshData = async () => {
    if (!user || !isConnected) return

    try {
      const [projRes, noteRes, membersRes, tbRes, activeRes, workspacesRes, capacityRes] = await Promise.all([
        fetch(`${BACKEND_URL}/projects`, { headers: getHeaders() }),
        fetch(`${BACKEND_URL}/notes`, { headers: getHeaders() }),
        fetch(`${BACKEND_URL}/projects/members`, { headers: getHeaders() }),
        fetch(`${BACKEND_URL}/projects/timeblocks/all`, { headers: getHeaders() }),
        fetch(`${BACKEND_URL}/tracking/active`, { headers: getHeaders() }),
        fetch(`${BACKEND_URL}/projects/workspaces`, { headers: getHeaders() }),
        fetch(`${BACKEND_URL}/projects/resources/capacity`, { headers: getHeaders() })
      ])

      if (projRes.ok) setProjects(await projRes.json())
      if (noteRes.ok) setNotes(await noteRes.json())
      if (membersRes.ok) setWorkspaceMembers(await membersRes.json())
      if (tbRes.ok) setTimeBlocks(await tbRes.json())
      if (workspacesRes.ok) setWorkspaces(await workspacesRes.json())
      if (capacityRes.ok) setResourceCapacity(await capacityRes.json())
      if (activeRes.ok) {
        const text = await activeRes.text()
        const act = text ? JSON.parse(text) : null
        setActiveTimer(act)
      }
    } catch (e) {
      console.error('Erreur lors du chargement des données depuis le backend :', e)
    }
  }

  useEffect(() => {
    refreshData()
  }, [user, isConnected])

  // SSO & Auth
  const login = async (code: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/github/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) throw new Error('Échec OAuth')
      const data = await res.json()
      const userData = { id: data.user.id, name: data.user.name, email: data.user.email, token: data.accessToken }
      setUser(userData)
      localStorage.setItem('planner_user', JSON.stringify(userData))
    } catch (e) {
      console.error(e)
      throw e
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('planner_user')
    setProjects([])
    setNotes([])
    setWorkspaceMembers([])
    setTimeBlocks([])
    setActiveTimer(null)
    if (socket) socket.disconnect()
  }

  const mockLogin = async (name: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/mock/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'Gaëtan' }),
      })
      if (!res.ok) throw new Error('Échec simulation login')
      const data = await res.json()
      const userData = { id: data.user.id, name: data.user.name, email: data.user.email, token: data.accessToken }
      setUser(userData)
      localStorage.setItem('planner_user', JSON.stringify(userData))
    } catch (e) {
      console.error(e)
      throw e
    }
  }


  // CRUD Projets
  const createProject = async (name: string, description?: string, workspaceId?: string, status?: string, startDate?: string, dueDate?: string) => {
    const res = await fetch(`${BACKEND_URL}/projects`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, description, workspaceId, status, startDate, dueDate })
    })
    if (res.ok) refreshData()
  }

  const deleteProject = async (projectId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}`, {
      method: 'DELETE',
      headers: getHeaders()
    })
    if (res.ok) refreshData()
  }

  // CRUD Tâches
  const createTask = async (projectId: string, title: string, description?: string, priority: string = 'MEDIUM', options: CreateTaskOptions = {}) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ title, description, priority, ...options })
    })
    if (res.ok) {
      const task = await res.json()
      refreshData()
      return task
    }
    return null
  }

  const updateTask = async (taskId: string, data: Partial<Task>) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    })
    if (res.ok) refreshData()
  }

  const deleteTask = async (taskId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}`, {
      method: 'DELETE',
      headers: getHeaders()
    })
    if (res.ok) refreshData()
  }

  const getProjectCriticalPath = async (projectId: string): Promise<{ criticalTaskIds: string[], slacks: Record<string, number> } | null> => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/critical-path`, {
      headers: getHeaders()
    })
    if (res.ok) {
      return res.json()
    }
    return null
  }

  // WebSocket Time Tracking
  const startTimer = (taskId: string) => {
    if (socket) {
      socket.emit('start-timer', { taskId })
    }
  }

  const stopTimer = () => {
    if (socket) {
      socket.emit('stop-timer')
    }
  }

  // CRUD Notes
  const saveNote = async (title: string, content: string, noteId?: string) => {
    const url = noteId ? `${BACKEND_URL}/notes/${noteId}` : `${BACKEND_URL}/notes`
    const method = noteId ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: getHeaders(),
      body: JSON.stringify({ title, content })
    })
    if (res.ok) refreshData()
  }

  const deleteNote = async (noteId: string) => {
    const res = await fetch(`${BACKEND_URL}/notes/${noteId}`, {
      method: 'DELETE',
      headers: getHeaders()
    })
    if (res.ok) refreshData()
  }

  // CRUD Calendrier (TimeBlocks)
  const createTimeBlock = async (taskId: string, startTime: string, endTime: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/timeblocks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ startTime, endTime })
    })
    if (res.ok) refreshData()
  }

  const updateTimeBlock = async (timeBlockId: string, startTime: string, endTime: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/timeblocks/${timeBlockId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ startTime, endTime })
    })
    if (res.ok) refreshData()
  }

  const deleteTimeBlock = async (timeBlockId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/timeblocks/${timeBlockId}`, {
      method: 'DELETE',
      headers: getHeaders()
    })
    if (res.ok) refreshData()
  }

  // Professional features
  const createMilestone = async (projectId: string, name: string, description?: string, dueDate?: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/milestones`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, description, dueDate })
    })
    if (res.ok) refreshData()
  }

  const completeMilestone = async (milestoneId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/milestones/${milestoneId}/complete`, {
      method: 'PUT',
      headers: getHeaders()
    })
    if (res.ok) refreshData()
  }

  const createDeliverable = async (projectId: string, title: string, description?: string, status?: string, dueDate?: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/deliverables`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ title, description, status, dueDate })
    })
    if (res.ok) refreshData()
  }

  const updateDeliverableStatus = async (deliverableId: string, status: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/deliverables/${deliverableId}/status/${status}`, {
      method: 'PUT',
      headers: getHeaders()
    })
    if (res.ok) refreshData()
  }

  const createDelivery = async (projectId: string, summary?: string, checklist?: string[]) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/deliveries`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ summary, checklist })
    })
    if (res.ok) refreshData()
  }

  const updateDeliveryStatus = async (deliveryId: string, status: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/deliveries/${deliveryId}/status`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ status })
    })
    if (res.ok) refreshData()
  }

  const toggleDeliveryChecklistItem = async (itemId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/deliveries/items/${itemId}/toggle`, {
      method: 'PUT',
      headers: getHeaders()
    })
    if (res.ok) refreshData()
  }

  const addTaskDependency = async (taskId: string, dependsOnTaskId: string, type: string = 'FINISH_TO_START') => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/dependencies`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ dependsOnTaskId, type })
    })
    if (res.ok) refreshData()
  }

  const removeTaskDependency = async (taskId: string, dependsOnTaskId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/dependencies/${dependsOnTaskId}`, {
      method: 'DELETE',
      headers: getHeaders()
    })
    if (res.ok) refreshData()
  }

  const updateResourceProfile = async (userId: string, weeklyCapacityMinutes?: number, skills?: string, costRateCents?: number) => {
    const res = await fetch(`${BACKEND_URL}/projects/resources/${userId}/profile`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ weeklyCapacityMinutes, skills, costRateCents })
    })
    if (res.ok) refreshData()
  }

  const createResourceAllocation = async (projectId: string, userId: string, allocationPercent: number, roleLabel?: string, startDate?: string, endDate?: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/allocations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ userId, allocationPercent, roleLabel, startDate, endDate })
    })
    if (res.ok) refreshData()
  }

  // Agile
  const createSprint = async (name: string, startDate: string, endDate: string, workspaceId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/sprints`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, startDate, endDate })
    })
    if (res.ok) refreshData()
  }

  const updateSprintStatus = async (sprintId: string, status: 'PLANNED' | 'ACTIVE' | 'COMPLETED') => {
    const res = await fetch(`${BACKEND_URL}/projects/sprints/${sprintId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ status })
    })
    if (res.ok) refreshData()
  }

  const associateTasksToSprint = async (sprintId: string | null, taskIds: string[]) => {
    const sId = sprintId === null ? 'backlog' : sprintId
    const res = await fetch(`${BACKEND_URL}/projects/sprints/${sId}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ taskIds })
    })
    if (res.ok) refreshData()
  }

  const getBurndownData = async (sprintId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/sprints/${sprintId}/burndown`, {
      method: 'GET',
      headers: getHeaders()
    })
    if (!res.ok) return null
    return res.json()
  }

  const getVelocityData = async (workspaceId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/velocity`, {
      method: 'GET',
      headers: getHeaders()
    })
    if (!res.ok) return 0
    const data = await res.json()
    return typeof data === 'number' ? data : 0
  }

  const createInvitation = async (
    workspaceId: string,
    email: string | null,
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER',
    projectId?: string,
    durationDays?: number
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/invitations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email, role, projectId, durationDays })
    })
    if (res.ok) {
      return res.json()
    }
    return null
  }

  const listInvitations = async (workspaceId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/invitations`, {
      headers: getHeaders()
    })
    if (res.ok) {
      return res.json()
    }
    return []
  }

  const revokeInvitation = async (invitationId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/invitations/${invitationId}`, {
      method: 'DELETE',
      headers: getHeaders()
    })
    if (res.ok) refreshData()
  }

  const checkInvitation = async (token: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/invitations/check/${token}`)
    if (!res.ok) {
      throw new Error(await res.text() || "Lien d'invitation invalide ou expiré.")
    }
    return res.json()
  }

  const acceptInvitation = async (token: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/invitations/accept/${token}`, {
      method: 'POST',
      headers: getHeaders()
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Impossible d'accepter l'invitation.")
    }
    const data = await res.json()
    refreshData()
    return data
  }

  const addComment = async (taskId: string, content: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ content })
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Impossible d'ajouter le commentaire.")
    }
    return res.json()
  }

  const getComments = async (taskId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      headers: getHeaders()
    })
    if (res.ok) {
      return res.json()
    }
    return []
  }

  const deleteComment = async (commentId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/comments/${commentId}`, {
      method: 'DELETE',
      headers: getHeaders()
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Impossible de supprimer le commentaire.")
    }
  }

  const updateComment = async (commentId: string, content: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/comments/${commentId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ content })
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Impossible de modifier le commentaire.")
    }
    return res.json()
  }

  // Thème logic
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('planner_theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  // Notifications logic
  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission()
      console.log('Permission notification:', permission)
    }
  }

  const sendBrowserNotification = (title: string, options?: NotificationOptions) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, options)
      } catch (e) {
        console.error('Erreur lors de l\'envoi de la notification:', e)
      }
    }
  }

  const scheduleReminder = (taskTitle: string, startTimeIso: string) => {
    const targetTime = new Date(startTimeIso).getTime()
    const now = Date.now()
    const reminderTime = targetTime - 5 * 60 * 1000
    const delay = reminderTime - now

    if (delay > 0) {
      console.log(`Rappel programmé pour "${taskTitle}" dans ${Math.round(delay / 1000)}s`)
      setTimeout(() => {
        sendBrowserNotification('Time-Blocking imminent !', {
          body: `Votre bloc de temps pour "${taskTitle}" commence dans 5 minutes.`,
        })
      }, delay)
    } else {
      const startDelay = targetTime - now
      if (startDelay > 0) {
        setTimeout(() => {
          sendBrowserNotification('Time-Blocking commencé !', {
            body: `C'est l'heure de commencer : "${taskTitle}"`,
          })
        }, startDelay)
      }
    }
  }

  const parseAiCommand = async (workspaceId: string, projectId: string | null, command: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/ai/command`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ workspaceId, projectId, command })
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors du traitement de la commande par l'IA.")
    }
    return res.json()
  }

  const executeAiActions = async (workspaceId: string, projectId: string | null, actions: any[]) => {
    const res = await fetch(`${BACKEND_URL}/projects/ai/execute`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ workspaceId, projectId, actions })
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors de l'exécution des actions IA.")
    }
    const data = await res.json()
    refreshData()
    return data
  }

  const parseAiVoiceCommand = async (workspaceId: string, projectId: string | null, audioBlob: Blob) => {
    const formData = new FormData()
    formData.append('file', audioBlob, 'voice-command.webm')
    formData.append('workspaceId', workspaceId)
    if (projectId) {
      formData.append('projectId', projectId)
    }

    const res = await fetch(`${BACKEND_URL}/projects/ai/voice`, {
      method: 'POST',
      headers: {
        'Authorization': user?.token ? `Bearer ${user.token}` : ''
      },
      body: formData
    })

    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors de la transcription ou de l'analyse vocale.")
    }
    return res.json()
  }

  const parseAiImageCommand = async (workspaceId: string, projectId: string | null, imageBlob: Blob) => {
    const formData = new FormData()
    formData.append('file', imageBlob, 'whiteboard.png')
    formData.append('workspaceId', workspaceId)
    if (projectId) {
      formData.append('projectId', projectId)
    }

    const res = await fetch(`${BACKEND_URL}/projects/ai/vision`, {
      method: 'POST',
      headers: {
        'Authorization': user?.token ? `Bearer ${user.token}` : ''
      },
      body: formData
    })

    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors de l'analyse de l'image.")
    }
    return res.json()
  }

  const getCopilotAlerts = async (workspaceId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/ai/copilot/alerts?workspaceId=${workspaceId}`, {
      method: 'GET',
      headers: getHeaders(),
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors de la récupération des alertes.")
    }
    return res.json()
  }

  const getCopilotBriefing = async (workspaceId: string, isMock: boolean = false) => {
    const res = await fetch(`${BACKEND_URL}/projects/ai/copilot/briefing?workspaceId=${workspaceId}&isMock=${isMock}`, {
      method: 'GET',
      headers: getHeaders(),
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors de la génération du briefing.")
    }
    return res.json()
  }

  const listIntegrations = async (workspaceId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations`, {
      headers: getHeaders(),
    })
    if (res.ok) return res.json()
    return []
  }

  const createIntegration = async (
    workspaceId: string,
    type: 'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK',
    name: string,
    url?: string,
    calendarId?: string
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ type, name, url, calendarId }),
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors de la création de l'intégration.")
    }
    return res.json()
  }

  const toggleIntegration = async (integrationId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/integrations/${integrationId}/toggle`, {
      method: 'POST',
      headers: getHeaders(),
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors de l'activation/désactivation de l'intégration.")
    }
    return res.json()
  }

  const deleteIntegration = async (integrationId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/integrations/${integrationId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors de la suppression de l'intégration.")
    }
    return res.json()
  }

  const exportToCalendar = async (workspaceId: string, integrationId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations/${integrationId}/export`, {
      method: 'POST',
      headers: getHeaders(),
    })
    if (!res.ok) {
      throw new Error(await res.text() || "Erreur lors de l'exportation vers le calendrier externe.")
    }
    return res.json()
  }

  const getCalendarConflicts = async (workspaceId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/calendar-conflicts`, {
      headers: getHeaders(),
    })
    if (res.ok) return res.json()
    return []
  }

  // Demander la permission de notification au login
  useEffect(() => {
    if (user) {
      requestNotificationPermission()
    }
  }, [user])

  // Pomodoro logic
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPomodoroRunning && pomodoroTimeLeft > 0) {
      interval = setInterval(() => {
        setPomodoroTimeLeft((prev) => prev - 1)
      }, 1000)
    } else if (isPomodoroRunning && pomodoroTimeLeft === 0) {
      if (pomodoroState === 'focus') {
        stopTimer()
        setPomodoroState('break')
        setPomodoroTimeLeft(pomodoroSettings.breakDuration * 60)
        sendBrowserNotification('Session Focus terminée !', {
          body: 'Il est temps de faire une pause bien méritée.',
        })
      } else if (pomodoroState === 'break') {
        setPomodoroState('focus')
        setPomodoroTimeLeft(pomodoroSettings.focusDuration * 60)
        if (pomodoroTaskId) {
          startTimer(pomodoroTaskId)
        }
        sendBrowserNotification('La pause est terminée !', {
          body: 'C\'est parti pour une nouvelle session de focus.',
        })
      }
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isPomodoroRunning, pomodoroTimeLeft, pomodoroState, pomodoroSettings, pomodoroTaskId])

  const startPomodoro = (taskId: string) => {
    setPomodoroTaskId(taskId)
    setPomodoroState('focus')
    setPomodoroTimeLeft(pomodoroSettings.focusDuration * 60)
    setIsPomodoroRunning(true)
    startTimer(taskId)
  }

  const pausePomodoro = () => {
    setIsPomodoroRunning(false)
    stopTimer()
  }

  const resumePomodoro = () => {
    if (pomodoroTaskId) {
      setIsPomodoroRunning(true)
      if (pomodoroState === 'focus') {
        startTimer(pomodoroTaskId)
      }
    }
  }

  const resetPomodoro = () => {
    setIsPomodoroRunning(false)
    setPomodoroState('idle')
    setPomodoroTaskId(null)
    setPomodoroTimeLeft(pomodoroSettings.focusDuration * 60)
    stopTimer()
  }

  const skipBreak = () => {
    if (pomodoroState === 'break') {
      setPomodoroState('focus')
      setPomodoroTimeLeft(pomodoroSettings.focusDuration * 60)
      if (pomodoroTaskId) {
        startTimer(pomodoroTaskId)
      }
    }
  }

  const currentUserRole = useMemo(() => {
    if (!user || workspaceMembers.length === 0) return null
    const membership = workspaceMembers.find(m => m.user.id === user.id)
    return membership ? membership.role : null
  }, [user, workspaceMembers])

  const isReadOnly = useMemo(() => {
    return currentUserRole === 'VIEWER'
  }, [currentUserRole])

  return (
    <AppContext.Provider value={{
      user, projects, notes, workspaces, workspaceMembers, resourceCapacity, timeBlocks, activeTimer, activeTab, isConnected,
      login, logout, mockLogin, setActiveTab, createProject, deleteProject,
      createTask, updateTask, deleteTask, startTimer, stopTimer, saveNote, deleteNote,
      createTimeBlock, updateTimeBlock, deleteTimeBlock,
      // Pomodoro
      pomodoroState, pomodoroTaskId, pomodoroTimeLeft, pomodoroSettings, isPomodoroRunning,
      setPomodoroSettings, startPomodoro, pausePomodoro, resumePomodoro, resetPomodoro, skipBreak,
      // Thème
      theme, toggleTheme,
      // Notifications
      requestNotificationPermission, sendBrowserNotification, scheduleReminder,
      // Professional features
      createMilestone, completeMilestone, createDeliverable, updateDeliverableStatus,
      createDelivery, updateDeliveryStatus, toggleDeliveryChecklistItem, addTaskDependency, removeTaskDependency,
      getProjectCriticalPath,
      updateResourceProfile, createResourceAllocation, refreshData,
      // Invitations / Collaboration
      createInvitation, listInvitations, revokeInvitation, checkInvitation, acceptInvitation,
      // Commentaires & Communication
      socket, addComment, getComments, deleteComment, updateComment,
      parseAiCommand, executeAiActions, parseAiVoiceCommand, parseAiImageCommand,
      getCopilotAlerts, getCopilotBriefing,
      // Intégrations & Calendrier
      listIntegrations, createIntegration, toggleIntegration, deleteIntegration, exportToCalendar, getCalendarConflicts,
      // Agile
      createSprint, updateSprintStatus, associateTasksToSprint, getBurndownData, getVelocityData,
      // Permissions
      currentUserRole, isReadOnly
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => {
  const context = useContext(AppContext)
  if (context === undefined) throw new Error('useApp doit être utilisé dans un AppProvider')
  return context
}
