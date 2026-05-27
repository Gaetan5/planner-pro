import React, { createContext, useContext, useState, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'

export interface Task {
  id: string
  title: string
  description?: string
  status: 'TODO' | 'IN_PROGRESS' | 'DONE'
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  projectId: string
  project?: { name: string }
  noteId?: string
}

export interface Project {
  id: string
  name: string
  description?: string
  githubRepo?: string
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

interface AppContextType {
  user: { id: string; name: string; email: string; token?: string } | null
  projects: Project[]
  notes: Note[]
  timeBlocks: TimeBlock[]
  activeTimer: { id: string; startTime: string; taskId: string; task?: Task } | null
  activeTab: 'dashboard' | 'kanban' | 'calendar' | 'notes' | 'pomodoro'
  isConnected: boolean
  login: (code: string) => Promise<void>
  logout: () => void
  mockLogin: (name: string) => void
  setActiveTab: (tab: 'dashboard' | 'kanban' | 'calendar' | 'notes' | 'pomodoro') => void
  createProject: (name: string, description?: string) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>
  createTask: (projectId: string, title: string, description?: string, priority?: string) => Promise<void>
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
}

const AppContext = createContext<AppContextType | undefined>(undefined)

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppContextType['user']>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [activeTimer, setActiveTimer] = useState<AppContextType['activeTimer']>(null)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'kanban' | 'calendar' | 'notes' | 'pomodoro'>('dashboard')
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
          setSocket(newSocket)

          newSocket.on('connect', () => {
            console.log('Connecté au WebSocket backend')
          })

          newSocket.on('active-timer-state', (state) => {
            setActiveTimer(state)
          })

          newSocket.on('timer-started', (log) => {
            setActiveTimer({
              id: log.id,
              startTime: log.startTime,
              taskId: log.taskId,
              task: log.task
            })
          })

          newSocket.on('timer-stopped', () => {
            setActiveTimer(null)
          })

          newSocket.on('task-status-changed', () => {
            refreshData()
          })

          return () => {
            newSocket.close()
          }
        } else {
          setIsConnected(false)
        }
      } catch (err) {
        console.warn('Le serveur backend est injoignable.', err)
        setIsConnected(false)
      }
    }

    initConnection()
  }, [user])

  // Charger les données réelles depuis le backend
  const refreshData = async () => {
    if (!user || !isConnected) return

    try {
      const [projRes, noteRes, tbRes, activeRes] = await Promise.all([
        fetch(`${BACKEND_URL}/projects`, { headers: getHeaders() }),
        fetch(`${BACKEND_URL}/notes`, { headers: getHeaders() }),
        fetch(`${BACKEND_URL}/projects/timeblocks/all`, { headers: getHeaders() }),
        fetch(`${BACKEND_URL}/tracking/active`, { headers: getHeaders() })
      ])

      if (projRes.ok) setProjects(await projRes.json())
      if (noteRes.ok) setNotes(await noteRes.json())
      if (tbRes.ok) setTimeBlocks(await tbRes.json())
      if (activeRes.ok) {
        const act = await activeRes.json()
        setActiveTimer(act || null)
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
    setTimeBlocks([])
    setActiveTimer(null)
    if (socket) socket.disconnect()
  }

  const mockLogin = (name: string) => {
    // bypass pour le développement local
    const mockUserData = { id: 'default-user-id', name: name || 'Gaëtan', email: 'gaetan@planner.pro', token: 'mock-jwt-token' }
    setUser(mockUserData)
    localStorage.setItem('planner_user', JSON.stringify(mockUserData))
  }

  // CRUD Projets
  const createProject = async (name: string, description?: string) => {
    const res = await fetch(`${BACKEND_URL}/projects`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, description })
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
  const createTask = async (projectId: string, title: string, description?: string, priority: string = 'MEDIUM') => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ title, description, priority })
    })
    if (res.ok) refreshData()
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

  return (
    <AppContext.Provider value={{
      user, projects, notes, timeBlocks, activeTimer, activeTab, isConnected,
      login, logout, mockLogin, setActiveTab, createProject, deleteProject,
      createTask, updateTask, deleteTask, startTimer, stopTimer, saveNote, deleteNote,
      createTimeBlock, updateTimeBlock, deleteTimeBlock,
      // Pomodoro
      pomodoroState, pomodoroTaskId, pomodoroTimeLeft, pomodoroSettings, isPomodoroRunning,
      setPomodoroSettings, startPomodoro, pausePomodoro, resumePomodoro, resetPomodoro, skipBreak,
      // Thème
      theme, toggleTheme,
      // Notifications
      requestNotificationPermission, sendBrowserNotification, scheduleReminder
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
