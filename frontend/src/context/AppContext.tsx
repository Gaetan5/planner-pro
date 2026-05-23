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
  activeTab: 'dashboard' | 'kanban' | 'calendar' | 'notes'
  isConnected: boolean
  login: (code: string) => Promise<void>
  logout: () => void
  mockLogin: (name: string) => void
  setActiveTab: (tab: 'dashboard' | 'kanban' | 'calendar' | 'notes') => void
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
}

const AppContext = createContext<AppContextType | undefined>(undefined)

const BACKEND_URL = 'http://localhost:3001'

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppContextType['user']>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [activeTimer, setActiveTimer] = useState<AppContextType['activeTimer']>(null)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'kanban' | 'calendar' | 'notes'>('dashboard')
  const [isConnected, setIsConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)

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

  return (
    <AppContext.Provider value={{
      user, projects, notes, timeBlocks, activeTimer, activeTab, isConnected,
      login, logout, mockLogin, setActiveTab, createProject, deleteProject,
      createTask, updateTask, deleteTask, startTimer, stopTimer, saveNote, deleteNote,
      createTimeBlock, updateTimeBlock, deleteTimeBlock
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
