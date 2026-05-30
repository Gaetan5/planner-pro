import React, { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Clock, Square, ListTodo, Calendar as CalendarIcon } from 'lucide-react'
import { CopilotWidget } from './CopilotWidget'
import './DashboardContent.css'

export const DashboardContent: React.FC = () => {
  const { activeTimer, timeBlocks, projects, setActiveTab, stopTimer } = useApp()
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
    <div className="dashboard-layout">
      {/* active timer bar */}
      {activeTimer ? (
        <div className="glass-panel pulse-timer timer-bar timer-bar--active">
          <div className="timer-bar-left">
            <div className="timer-icon-container">
              <Clock className="pulse-timer" size={24} />
            </div>
            <div className="timer-info-text">
              <p className="timer-info-label">Tâche active en cours de tracking</p>
              <h2 className="timer-info-title">{activeTimer.task?.title || 'Chronométrage actif'}</h2>
            </div>
          </div>
          <div className="timer-bar-right">
            <span className="timer-time-display">{formatTime(timerSeconds)}</span>
            <button onClick={stopTimer} className="timer-stop-btn">
              <Square size={16} fill="#fff" /> Arrêter
            </button>
          </div>
        </div>
      ) : (
        <div className="glass-panel timer-bar timer-idle-bar">
          <div className="timer-idle-left">
            <Clock size={24} color="var(--text-muted)" />
            <p className="timer-idle-text">Aucun chronomètre en cours. Démarrez-en un depuis le module Kanban.</p>
          </div>
          <button onClick={() => setActiveTab('kanban')} className="btn-primary">
            Ouvrir Kanban
          </button>
        </div>
      )}

      {/* Copilote IA Proactif */}
      <CopilotWidget />

      {/* Grid widgets */}
      <div className="dashboard-grid">
        {/* Résumé des statistiques de productivité */}
        <section className="glass-panel dashboard-widget">
          <h3 className="widget-title">
            <ListTodo size={18} color="var(--accent-primary)" /> Aperçu des Projets & Tâches
          </h3>
          <div className="stat-grid">
            <div className="glass-panel stat-card">
              <span className="stat-card-number">{projects.length}</span>
              <p className="stat-card-label">Projets</p>
            </div>
            <div className="glass-panel stat-card">
              <span className="stat-card-number stat-card-number--primary">{inProgressTasks.length}</span>
              <p className="stat-card-label">En Cours</p>
            </div>
            <div className="glass-panel stat-card">
              <span className="stat-card-number stat-card-number--success">{completedTasks.length}</span>
              <p className="stat-card-label">Terminées</p>
            </div>
          </div>

          <div className="urgent-tasks-section">
            <h4 className="urgent-tasks-title">Tâches urgentes à réaliser</h4>
            <div className="urgent-tasks-list">
              {allTasks.filter(t => t.status !== 'DONE').slice(0, 3).map(task => (
                <div key={task.id} className={`urgent-task-item ${task.priority === 'HIGH' ? 'urgent-task-item--high' : ''}`}>
                  <span className="urgent-task-title">{task.title}</span>
                  <span className="urgent-task-priority">{task.priority}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Prochains blocs horaires (Calendrier) */}
        <section className="glass-panel dashboard-widget">
          <h3 className="widget-title">
            <CalendarIcon size={18} color="var(--accent-primary)" /> Emploi du Temps du Jour
          </h3>
          <div className="schedule-list">
            {timeBlocks.length === 0 ? (
              <div className="schedule-empty">
                <CalendarIcon size={32} className="schedule-empty-icon" />
                <p className="schedule-empty-text">Aucun bloc horaire planifié aujourd'hui.</p>
                <button onClick={() => setActiveTab('calendar')} className="btn-primary schedule-empty-btn">Time-blocker une tâche</button>
              </div>
            ) : (
              timeBlocks.map(tb => {
                const start = new Date(tb.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={tb.id} className="schedule-card">
                    <div className="schedule-time">{start}</div>
                    <div className="schedule-details">
                      <h4 className="schedule-task-title">{tb.task?.title}</h4>
                      <p className="schedule-project-name">Projet : {tb.task?.project?.name || 'Inbox'}</p>
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
