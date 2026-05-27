import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Play, Pause, RotateCcw, SkipForward, Settings, Clock, CheckCircle } from 'lucide-react'
import './PomodoroTimer.css'

export const PomodoroTimer: React.FC = () => {
  const {
    projects,
    pomodoroState,
    pomodoroTaskId,
    pomodoroTimeLeft,
    pomodoroSettings,
    isPomodoroRunning,
    setPomodoroSettings,
    startPomodoro,
    pausePomodoro,
    resumePomodoro,
    resetPomodoro,
    skipBreak,
  } = useApp()

  const [showSettings, setShowSettings] = useState(false)
  const [tempFocus, setTempFocus] = useState(pomodoroSettings.focusDuration)
  const [tempBreak, setTempBreak] = useState(pomodoroSettings.breakDuration)
  const [selectedTaskId, setSelectedTaskId] = useState<string>('')

  // Trouver la tâche en cours
  const allTasks = projects.flatMap((p) => p.tasks || [])
  const currentTask = allTasks.find((t) => t.id === pomodoroTaskId)

  // Calculer le pourcentage de temps restant
  const totalSeconds = (pomodoroState === 'break' ? pomodoroSettings.breakDuration : pomodoroSettings.focusDuration) * 60
  const progressPercent = totalSeconds > 0 ? ((totalSeconds - pomodoroTimeLeft) / totalSeconds) * 100 : 0

  // Formater le temps restant en MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Gérer la sauvegarde des settings
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault()
    setPomodoroSettings({
      focusDuration: tempFocus,
      breakDuration: tempBreak,
    })
    setShowSettings(false)
    resetPomodoro()
  }

  const handleStart = () => {
    if (pomodoroState === 'idle') {
      if (!selectedTaskId) {
        alert('Veuillez sélectionner une tâche à lier à ce cycle Pomodoro.')
        return
      }
      startPomodoro(selectedTaskId)
    } else {
      resumePomodoro()
    }
  }

  return (
    <div className={`pomodoro-container ${pomodoroState}`}>
      <div className="glass-panel pomodoro-card">
        <h2 className="pomodoro-title">Minuteur Pomodoro</h2>

        {/* Cercle de progression SVG */}
        <div className="timer-display-container">
          <svg className="timer-svg" viewBox="0 0 200 200">
            <circle className="timer-circle-bg" cx="100" cy="100" r="85" />
            <circle
              className={`timer-circle-progress ${pomodoroState}`}
              cx="100"
              cy="100"
              r="85"
              style={{
                strokeDasharray: 534,
                strokeDashoffset: 534 - (534 * progressPercent) / 100,
              }}
            />
          </svg>
          <div className="timer-text-overlay">
            <span className="timer-time">{formatTime(pomodoroTimeLeft)}</span>
            <span className="timer-status">
              {pomodoroState === 'idle' && 'Prêt'}
              {pomodoroState === 'focus' && 'Focus Session'}
              {pomodoroState === 'break' && 'Pause'}
            </span>
          </div>
        </div>

        {/* Tâche sélectionnée ou sélecteur de tâche */}
        <div className="pomodoro-task-section">
          {pomodoroState !== 'idle' && currentTask ? (
            <div className="current-task-badge">
              <CheckCircle size={14} className="badge-icon" />
              <span>Tâche : <strong>{currentTask.title}</strong></span>
            </div>
          ) : (
            <div className="task-selector-wrapper">
              <label htmlFor="pomodoro-task">Lier une tâche :</label>
              <select
                id="pomodoro-task"
                className="glass-input"
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                disabled={pomodoroState !== 'idle'}
              >
                <option value="">-- Choisir une tâche --</option>
                {projects.map((proj) => (
                  <optgroup key={proj.id} label={proj.name}>
                    {proj.tasks && proj.tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Boutons de contrôle */}
        <div className="timer-controls">
          {isPomodoroRunning ? (
            <button className="btn-control pause" onClick={pausePomodoro} title="Pause">
              <Pause size={20} />
            </button>
          ) : (
            <button className="btn-control play" onClick={handleStart} title="Démarrer">
              <Play size={20} />
            </button>
          )}

          {pomodoroState !== 'idle' && (
            <button className="btn-control reset" onClick={resetPomodoro} title="Réinitialiser">
              <RotateCcw size={20} />
            </button>
          )}

          {pomodoroState === 'break' && (
            <button className="btn-control skip" onClick={skipBreak} title="Passer la pause">
              <SkipForward size={20} />
            </button>
          )}

          <button
            className={`btn-control settings-toggle ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Paramètres"
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Panel Paramètres */}
        {showSettings && (
          <form className="glass-panel pomodoro-settings-form" onSubmit={handleSaveSettings}>
            <h3>Durée des sessions</h3>
            <div className="settings-grid">
              <div className="setting-field">
                <label>Focus (min)</label>
                <div className="input-with-icon">
                  <Clock size={16} />
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={tempFocus}
                    onChange={(e) => setTempFocus(parseInt(e.target.value) || 25)}
                  />
                </div>
              </div>
              <div className="setting-field">
                <label>Pause (min)</label>
                <div className="input-with-icon">
                  <Clock size={16} />
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={tempBreak}
                    onChange={(e) => setTempBreak(parseInt(e.target.value) || 5)}
                  />
                </div>
              </div>
            </div>
            <div className="settings-actions">
              <button type="button" className="btn-text" onClick={() => setShowSettings(false)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Appliquer
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
