import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Calendar as CalendarIcon, Clock, Plus, Trash2 } from 'lucide-react'

export const CalendarView: React.FC = () => {
  const { projects, timeBlocks, createTimeBlock, deleteTimeBlock } = useApp()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  // Extraire toutes les tâches de tous les projets
  const allTasks = projects.flatMap(p => p.tasks || [])

  // Filtrer les tâches non planifiées (qui n'ont pas de TimeBlock)
  const unscheduledTasks = allTasks.filter(task =>
    !timeBlocks.some(tb => tb.taskId === task.id)
  )

  // Heures de la journée de 8:00 à 18:00
  const hours = Array.from({ length: 11 }, (_, i) => i + 8)

  const handleScheduleTask = (hour: number) => {
    if (!selectedTaskId) return

    // Planifier pour aujourd'hui à l'heure sélectionnée (durée par défaut : 1h)
    const today = new Date()
    const startTime = new Date(today.setHours(hour, 0, 0, 0)).toISOString()
    const endTime = new Date(today.setHours(hour + 1, 0, 0, 0)).toISOString()

    createTimeBlock(selectedTaskId, startTime, endTime)
    setSelectedTaskId(null)
  }

  const formatHour = (hour: number) => `${hour.toString().padStart(2, '0')}:00`

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px', flex: 1, minHeight: 0 }}>
      {/* Sidebar des tâches non planifiées */}
      <aside className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
        <div>
          <h3 style={{ fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarIcon size={18} color="var(--accent-primary)" /> Time-Blocking
          </h3>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Sélectionnez une tâche ci-dessous puis cliquez sur un créneau horaire dans l'agenda.
          </p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
          {unscheduledTasks.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              Aucune tâche à planifier. Créez-en dans le Kanban !
            </div>
          ) : (
            unscheduledTasks.map(task => (
              <div
                key={task.id}
                onClick={() => setSelectedTaskId(task.id === selectedTaskId ? null : task.id)}
                style={{
                  padding: '12px',
                  background: task.id === selectedTaskId ? 'rgba(99, 102, 241, 0.15)' : 'var(--glass-highlight)',
                  border: task.id === selectedTaskId ? '1px solid var(--accent-primary)' : '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <h5 style={{ fontSize: '13px', fontWeight: 600 }}>{task.title}</h5>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  Priorité : {task.priority}
                </span>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Agenda Horaire Journalier */}
      <section className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Clock size={20} color="var(--accent-primary)" /> Emploi du temps - Aujourd'hui
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {hours.map(hour => {
            // Trouver si un TimeBlock existe pour cette heure
            const block = timeBlocks.find(tb => {
              const start = new Date(tb.startTime).getHours()
              return start === hour
            })

            return (
              <div
                key={hour}
                onClick={() => !block && handleScheduleTask(hour)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr',
                  alignItems: 'center',
                  minHeight: '64px',
                  borderBottom: '1px solid var(--glass-border)',
                  cursor: block ? 'default' : selectedTaskId ? 'pointer' : 'default',
                  background: !block && selectedTaskId ? 'rgba(99, 102, 241, 0.02)' : 'none',
                  borderRadius: 'var(--radius-sm)',
                  transition: 'background 0.2s'
                }}
              >
                {/* Heure */}
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {formatHour(hour)}
                </span>

                {/* Bloc horaire planifié ou vide */}
                {block ? (
                  <div style={{
                    background: 'var(--accent-gradient)',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-sm)',
                    boxShadow: 'var(--shadow-sm)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: '#fff',
                    animation: 'pulse-glow 4s infinite'
                  }}>
                    <div>
                      <h4 style={{ fontSize: '14px', fontWeight: 600 }}>{block.task?.title || 'Tâche planifiée'}</h4>
                      <p style={{ fontSize: '10px', opacity: 0.8 }}>Projet : {block.task?.project?.name || 'Inbox'}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteTimeBlock(block.id) }}
                      style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', opacity: 0.8 }}
                      onMouseOver={e => e.currentTarget.style.opacity = '1'}
                      onMouseOut={e => e.currentTarget.style.opacity = '0.8'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ) : (
                  <div style={{
                    height: '100%',
                    border: '1px dashed var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    opacity: selectedTaskId ? 0.8 : 0.4
                  }}>
                    {selectedTaskId ? 'Cliquez pour planifier ici' : 'Créneau libre'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
