import React, { useState, useEffect } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { Login } from './components/Login'
import { KanbanBoard } from './components/KanbanBoard'
import { CalendarView } from './components/CalendarView'
import { Notepad } from './components/Notepad'
import { Play, Square, Calendar as CalendarIcon, ListTodo, FileText, Bell, Clock, FolderGit2, LogOut, Info, AlertTriangle } from 'lucide-react'

function DashboardContent() {
  const { activeTimer, timeBlocks, projects, notes, setActiveTab, stopTimer } = useApp()
  const [timerSeconds, setTimerSeconds] = useState(0)

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (activeTimer) {
      const start = new Date(activeTimer.startTime).getTime()
      interval = setInterval(() => {
        setTimerSeconds(Math.floor((Date.now() - start) / 1000))
      }, 1000)
    } else {
      setTimerSeconds(0)
    }
    return () => clearInterval(interval)
  }, [activeTimer])

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0')
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
    const secs = (seconds % 60).toString().padStart(2, '0')
    return `${hrs}:${mins}:${secs}`
  }

  const allTasks = projects.flatMap(p => p.tasks || [])
  const completedTasks = allTasks.filter(t => t.status === 'DONE')
  const inProgressTasks = allTasks.filter(t => t.status === 'IN_PROGRESS')

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: '24px', flex: 1, minHeight: 0 }}>
      {/* active timer bar */}
      {activeTimer ? (
        <div className="glass-panel pulse-timer" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-primary)', width: '48px', height: '48px', borderRadius: '12px' }}>
              <Clock className="pulse-timer" size={24} />
            </div>
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Tâche active en cours de tracking</p>
              <h2 style={{ fontSize: '16px', fontWeight: 600 }}>{activeTimer.task?.title || 'Chronométrage actif'}</h2>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <span style={{ fontSize: '32px', fontFamily: 'monospace', fontWeight: 700 }}>{formatTime(timerSeconds)}</span>
            <button onClick={stopTimer} style={{ background: 'var(--color-error)', border: 'none', color: '#fff', padding: '12px 24px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
              <Square size={16} fill="#fff" /> Arrêter
            </button>
          </div>
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Clock size={24} color="var(--text-muted)" />
            <p style={{ fontSize: '14px' }}>Aucun chronomètre en cours. Démarrez-en un depuis le module Kanban.</p>
          </div>
          <button onClick={() => setActiveTab('kanban')} className="btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }}>
            Ouvrir Kanban
          </button>
        </div>
      )}

      {/* Grid widgets */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', minHeight: 0 }}>
        {/* Résumé des statistiques de productivité */}
        <section className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ListTodo size={18} color="var(--accent-primary)" /> Aperçu des Projets & Tâches
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div className="glass-panel" style={{ padding: '16px', textAlign: 'center', background: 'var(--glass-highlight)' }}>
              <span style={{ fontSize: '28px', fontWeight: 800 }}>{projects.length}</span>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Projets</p>
            </div>
            <div className="glass-panel" style={{ padding: '16px', textAlign: 'center', background: 'var(--glass-highlight)' }}>
              <span style={{ fontSize: '28px', fontWeight: 800, color: 'var(--accent-primary)' }}>{inProgressTasks.length}</span>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>En Cours</p>
            </div>
            <div className="glass-panel" style={{ padding: '16px', textAlign: 'center', background: 'var(--glass-highlight)' }}>
              <span style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-success)' }}>{completedTasks.length}</span>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Terminées</p>
            </div>
          </div>

          <div style={{ marginTop: '8px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Tâches urgentes à réaliser</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {allTasks.filter(t => t.status !== 'DONE').slice(0, 3).map(task => (
                <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--glass-highlight)', borderRadius: 'var(--radius-sm)', borderLeft: task.priority === 'HIGH' ? '3px solid var(--color-error)' : 'none' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>{task.title}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{task.priority}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Prochains blocs horaires (Calendrier) */}
        <section className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarIcon size={18} color="var(--accent-primary)" /> Emploi du Temps du Jour
          </h3>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
            {timeBlocks.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', textAlign: 'center' }}>
                <CalendarIcon size={32} style={{ marginBottom: '8px', opacity: 0.5 }} />
                <p style={{ fontSize: '13px' }}>Aucun bloc horaire planifié aujourd'hui.</p>
                <button onClick={() => setActiveTab('calendar')} className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px', marginTop: '12px' }}>Time-blocker une tâche</button>
              </div>
            ) : (
              timeBlocks.map(tb => {
                const start = new Date(tb.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={tb.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 16px', background: 'var(--glass-highlight)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-primary)' }}>{start}</div>
                    <div>
                      <h4 style={{ fontSize: '13px', fontWeight: 600 }}>{tb.task?.title}</h4>
                      <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Projet : {tb.task?.project?.name || 'Inbox'}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function AppWithSession() {
  const { user, logout, activeTab, setActiveTab, isConnected } = useApp()

  if (!user) {
    return <Login />
  }

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'kanban': return <KanbanBoard />
      case 'calendar': return <CalendarView />
      case 'notes': return <Notepad />
      default: return <DashboardContent />
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '24px', gap: '24px' }}>
      {/* Header */}
      <header className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--accent-gradient)', width: '38px', height: '38px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FolderGit2 size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.5px' }}>Planner-Pro</h1>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Focus & Flow Hub</p>
          </div>
        </div>

        {/* Tab Selection */}
        <nav style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('dashboard')}
            className="glass-panel"
            style={{
              padding: '8px 16px',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === 'dashboard' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              background: activeTab === 'dashboard' ? 'var(--glass-highlight)' : 'none',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('kanban')}
            className="glass-panel"
            style={{
              padding: '8px 16px',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === 'kanban' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              background: activeTab === 'kanban' ? 'var(--glass-highlight)' : 'none',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            Kanban
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className="glass-panel"
            style={{
              padding: '8px 16px',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === 'calendar' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              background: activeTab === 'calendar' ? 'var(--glass-highlight)' : 'none',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            Calendrier
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className="glass-panel"
            style={{
              padding: '8px 16px',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === 'notes' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              background: activeTab === 'notes' ? 'var(--glass-highlight)' : 'none',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            Notes
          </button>
        </nav>

        {/* Profil & Mode Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {!isConnected ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: 'var(--color-error)',
              background: 'rgba(239, 68, 68, 0.1)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(239, 68, 68, 0.2)'
            }}>
              <AlertTriangle size={12} />
              Serveur Déconnecté
            </div>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: 'var(--color-success)',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(16, 185, 129, 0.2)'
            }}>
              Connecté au Backend
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '13px', fontWeight: 600 }}>{user.name}</p>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{user.email}</p>
            </div>
            <button
              onClick={logout}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '50%'
              }}
              onMouseOver={e => e.currentTarget.style.color = 'var(--color-error)'}
              onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Page Area */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {renderActiveTab()}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppWithSession />
    </AppProvider>
  )
}
