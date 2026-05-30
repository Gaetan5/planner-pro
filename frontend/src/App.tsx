import { useState } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { Login } from './components/Login'
import { InvitationAcceptance } from './components/InvitationAcceptance'
import { KanbanBoard } from './components/KanbanBoard'
import { CalendarView } from './components/CalendarView'
import { Notepad } from './components/Notepad'
import { DashboardContent } from './components/DashboardContent'
import { PomodoroTimer } from './components/PomodoroTimer'
import { AiCommandBar } from './components/AiCommandBar'
import { GovernanceView } from './components/GovernanceView'
import { CapacityView } from './components/CapacityView'
import { AgileView } from './components/AgileView'
import { GanttView } from './components/GanttView'
import { LogOut, AlertTriangle, LayoutDashboard, Kanban, Calendar, FileText, Timer, Sun, Moon, ShieldCheck, Users, Sparkles, Milestone, CalendarRange } from 'lucide-react'
import logo from './logo.png'
import './App.css'

function AppWithSession() {
  const { user, logout, activeTab, setActiveTab, isConnected, theme, toggleTheme } = useApp()
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('token')
  })

  if (inviteToken) {
    return <InvitationAcceptance token={inviteToken} onClose={() => setInviteToken(null)} />
  }

  if (!user) {
    return <Login />
  }

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'kanban': return <KanbanBoard />
      case 'calendar': return <CalendarView />
      case 'notes': return <Notepad />
      case 'pomodoro': return <PomodoroTimer />
      case 'governance': return <GovernanceView />
      case 'resources': return <CapacityView />
      case 'agile': return <AgileView />
      case 'gantt': return <GanttView />
      default: return <DashboardContent />
    }
  }

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="glass-panel app-header">
        <div className="app-brand">
          <div className="app-brand__logo">
            <img src={logo} alt="Planner-Pro Logo" />
          </div>
          <div>
            <h1 className="app-brand__title">Planner-Pro</h1>
            <p className="app-brand__subtitle">Focus & Flow Hub</p>
          </div>
        </div>

        {/* Tab Selection */}
        <nav className="app-nav desktop-only">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`nav-tab ${activeTab === 'dashboard' ? 'nav-tab--active' : ''}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('kanban')}
            className={`nav-tab ${activeTab === 'kanban' ? 'nav-tab--active' : ''}`}
          >
            Kanban
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`nav-tab ${activeTab === 'calendar' ? 'nav-tab--active' : ''}`}
          >
            Calendrier
          </button>
          <button
            onClick={() => setActiveTab('gantt')}
            className={`nav-tab ${activeTab === 'gantt' ? 'nav-tab--active' : ''}`}
          >
            Gantt
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className={`nav-tab ${activeTab === 'notes' ? 'nav-tab--active' : ''}`}
          >
            Notes
          </button>
          <button
            onClick={() => setActiveTab('pomodoro')}
            className={`nav-tab ${activeTab === 'pomodoro' ? 'nav-tab--active' : ''}`}
          >
            Pomodoro
          </button>
          <button
            onClick={() => setActiveTab('governance')}
            className={`nav-tab ${activeTab === 'governance' ? 'nav-tab--active' : ''}`}
          >
            Gouvernance
          </button>
          <button
            onClick={() => setActiveTab('resources')}
            className={`nav-tab ${activeTab === 'resources' ? 'nav-tab--active' : ''}`}
          >
            Ressources
          </button>
          <button
            onClick={() => setActiveTab('agile')}
            className={`nav-tab ${activeTab === 'agile' ? 'nav-tab--active' : ''}`}
          >
            Agile
          </button>
        </nav>

        {/* Profil & Mode Info */}
        <div className="app-header-right">
          {!isConnected ? (
            <div className="connection-badge badge--error">
              <AlertTriangle size={12} />
              Serveur Déconnecté
            </div>
          ) : (
            <div className="connection-badge badge--success">
              Connecté au Backend
            </div>
          )}

          {/* Assistant IA Command Button */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('open-ai-command-bar'))}
            className="btn-icon ai-command-btn"
            title="Ouvrir l'Assistant IA (⌘+K)"
            style={{ marginRight: '8px', color: '#8b5cf6' }}
          >
            <Sparkles size={16} />
          </button>

          {/* Theme Toggle Switcher */}
          <button
            onClick={toggleTheme}
            className="btn-icon theme-toggle-btn"
            title={theme === 'dark' ? 'Passer au mode clair' : 'Passer au mode sombre'}
            style={{ marginRight: '8px' }}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <div className="user-info">
            <div className="user-info__details">
              <p className="user-info__name">{user.name}</p>
              <p className="user-info__email">{user.email}</p>
            </div>
            <button
              onClick={logout}
              className="btn-icon btn-icon--danger"
              title="Se déconnecter"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Page Area */}
      <div className="app-main">
        {renderActiveTab()}
      </div>

      {/* Bottom Navigation for Mobile */}
      <nav className="app-bottom-nav mobile-only">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`bottom-nav-item ${activeTab === 'dashboard' ? 'bottom-nav-item--active' : ''}`}
        >
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </button>
        <button
          onClick={() => setActiveTab('kanban')}
          className={`bottom-nav-item ${activeTab === 'kanban' ? 'bottom-nav-item--active' : ''}`}
        >
          <Kanban size={20} />
          <span>Kanban</span>
        </button>
        <button
          onClick={() => setActiveTab('calendar')}
          className={`bottom-nav-item ${activeTab === 'calendar' ? 'bottom-nav-item--active' : ''}`}
        >
          <Calendar size={20} />
          <span>Calendrier</span>
        </button>
        <button
          onClick={() => setActiveTab('gantt')}
          className={`bottom-nav-item ${activeTab === 'gantt' ? 'bottom-nav-item--active' : ''}`}
        >
          <CalendarRange size={20} />
          <span>Gantt</span>
        </button>
        <button
          onClick={() => setActiveTab('notes')}
          className={`bottom-nav-item ${activeTab === 'notes' ? 'bottom-nav-item--active' : ''}`}
        >
          <FileText size={20} />
          <span>Notes</span>
        </button>
        <button
          onClick={() => setActiveTab('pomodoro')}
          className={`bottom-nav-item ${activeTab === 'pomodoro' ? 'bottom-nav-item--active' : ''}`}
        >
          <Timer size={20} />
          <span>Pomodoro</span>
        </button>
        <button
          onClick={() => setActiveTab('governance')}
          className={`bottom-nav-item ${activeTab === 'governance' ? 'bottom-nav-item--active' : ''}`}
        >
          <ShieldCheck size={20} />
          <span>Gouv.</span>
        </button>
        <button
          onClick={() => setActiveTab('resources')}
          className={`bottom-nav-item ${activeTab === 'resources' ? 'bottom-nav-item--active' : ''}`}
        >
          <Users size={20} />
          <span>Ress.</span>
        </button>
        <button
          onClick={() => setActiveTab('agile')}
          className={`bottom-nav-item ${activeTab === 'agile' ? 'bottom-nav-item--active' : ''}`}
        >
          <Milestone size={20} />
          <span>Agile</span>
        </button>
      </nav>
      <AiCommandBar />
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
