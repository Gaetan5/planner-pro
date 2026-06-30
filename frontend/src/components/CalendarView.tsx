import React, { useState } from 'react';
import { useApp, Task, TimeBlock } from '../context/AppContext';
import { Calendar as CalendarIcon, Clock, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  addDays,
  format,
  isSameDay,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isToday,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import './CalendarView.css';

/* ======== Draggable Card for Unscheduled Tasks ======== */
function DraggableTaskCard({
  task,
  isSelected,
  onClick,
}: {
  task: Task;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`calendar-unscheduled-card ${isSelected ? 'calendar-unscheduled-card--selected' : ''} ${isDragging ? 'calendar-unscheduled-card--dragging' : ''}`}
    >
      <h5>{task.title}</h5>
      <span>Priorité : {task.priority}</span>
    </div>
  );
}

/* ======== Droppable Slot for Grid Cell ======== */
interface DroppableSlotProps {
  slotId: string;
  block?: TimeBlock;
  hour: number;
  date: Date;
  isWeekView: boolean;
  selectedTaskId: string | null;
  onSchedule: (dateStr: string, hour: number) => void;
  onDeleteBlock: (id: string) => void;
}

function DroppableSlot({
  slotId,
  block,
  hour,
  date,
  isWeekView,
  selectedTaskId,
  onSchedule,
  onDeleteBlock,
}: DroppableSlotProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: slotId,
    disabled: !!block,
  });

  const dateStr = format(date, 'yyyy-MM-dd');

  const handleCellClick = () => {
    if (!block && selectedTaskId) {
      onSchedule(dateStr, hour);
    }
  };

  return (
    <div
      ref={setNodeRef}
      onClick={handleCellClick}
      style={{
        height: '100%',
        minHeight: isWeekView ? '64px' : 'auto',
        position: 'relative',
        cursor: block ? 'default' : selectedTaskId ? 'pointer' : 'default',
      }}
    >
      {block ? (
        <div className="time-block-card">
          <div style={{ minWidth: 0, flex: 1, paddingRight: '8px' }}>
            <h4
              style={{
                fontSize: isWeekView ? '11px' : '14px',
                lineHeight: '1.2',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: isWeekView ? 'nowrap' : 'normal',
              }}
            >
              {block.task?.title || 'Tâche planifiée'}
            </h4>
            {!isWeekView && (
              <p style={{ margin: 0, fontSize: '10px', opacity: 0.8 }}>
                Projet : {block.task?.project?.name || 'Inbox'}
              </p>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteBlock(block.id);
            }}
            className="time-block-delete-btn"
          >
            <Trash2 size={isWeekView ? 12 : 16} />
          </button>
        </div>
      ) : (
        <div
          className={`time-slot-placeholder ${selectedTaskId ? 'time-slot-placeholder--active' : ''} ${isOver ? 'time-slot-placeholder--over' : ''}`}
        >
          {isOver ? '+' : ''}
        </div>
      )}
    </div>
  );
}

/* ======== Main Component ======== */
export const CalendarView: React.FC = () => {
  const { projects, timeBlocks, createTimeBlock, deleteTimeBlock, scheduleReminder } = useApp();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);

  // Date et mode de vue
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  // Extraire toutes les tâches de tous les projets
  const allTasks = projects.flatMap((p) => p.tasks || []);

  // Filtrer les tâches non planifiées
  const unscheduledTasks = allTasks.filter(
    (task) => !timeBlocks.some((tb) => tb.taskId === task.id),
  );

  // Plage horaire étendue 6h à 23h
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);

  // Navigation de date
  const handlePrev = () => {
    setCurrentDate((d) => addDays(d, viewMode === 'day' ? -1 : -7));
  };

  const handleNext = () => {
    setCurrentDate((d) => addDays(d, viewMode === 'day' ? 1 : 7));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleScheduleTask = (dateStr: string, hour: number, taskIdParam?: string) => {
    const taskId = taskIdParam || selectedTaskId || activeDragTaskId;
    if (!taskId) return;

    const targetDate = new Date(dateStr);
    const startTime = new Date(targetDate.setHours(hour, 0, 0, 0)).toISOString();
    const endTime = new Date(targetDate.setHours(hour + 1, 0, 0, 0)).toISOString();

    createTimeBlock(taskId, startTime, endTime);

    // Planifier la notification de rappel
    const allTasks = projects.flatMap((p) => p.tasks || []);
    const task = allTasks.find((t) => t.id === taskId);
    if (task) {
      scheduleReminder(task.title, startTime);
    }

    setSelectedTaskId(null);
  };

  // DnD Handlers
  const handleDragStart = (event: any) => {
    const taskId = event.active.id as string;
    setActiveDragTaskId(taskId);
    setSelectedTaskId(taskId);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragTaskId(null);
    setSelectedTaskId(null);

    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;
    const match = overId.match(/^slot-(\d{4}-\d{2}-\d{2})-(\d+)$/);

    if (match) {
      const dateStr = match[1];
      const hour = parseInt(match[2], 10);
      handleScheduleTask(dateStr, hour, taskId);
    }
  };

  const formatHour = (hour: number) => `${hour.toString().padStart(2, '0')}:00`;

  // Calculer les jours de la semaine courante
  const weekDays = eachDayOfInterval({
    start: startOfWeek(currentDate, { weekStartsOn: 1 }),
    end: endOfWeek(currentDate, { weekStartsOn: 1 }),
  });

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="calendar-layout">
        {/* Sidebar des tâches non planifiées */}
        <aside className="glass-panel calendar-sidebar">
          <div className="calendar-sidebar-header">
            <h3 className="calendar-sidebar-title">
              <CalendarIcon size={18} color="var(--accent-primary)" /> Time-Blocking
            </h3>
            <p className="calendar-sidebar-subtitle">
              Sélectionnez une tâche puis cliquez sur un créneau ou glissez-déposez-la.
            </p>
          </div>

          <div className="calendar-unscheduled-list">
            {unscheduledTasks.length === 0 ? (
              <div className="calendar-empty-state">
                Aucune tâche à planifier. Créez-en dans le Kanban !
              </div>
            ) : (
              unscheduledTasks.map((task) => (
                <DraggableTaskCard
                  key={task.id}
                  task={task}
                  isSelected={task.id === selectedTaskId}
                  onClick={() => setSelectedTaskId(task.id === selectedTaskId ? null : task.id)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Agenda principal */}
        <section className="glass-panel calendar-main">
          <div className="calendar-header">
            {/* Titre & Date */}
            <div className="calendar-header-title">
              <Clock size={20} color="var(--accent-primary)" />
              <span>
                {viewMode === 'day'
                  ? format(currentDate, 'EEEE d MMMM yyyy', { locale: fr })
                  : `Semaine du ${format(weekDays[0], 'd MMMM', { locale: fr })} au ${format(weekDays[6], 'd MMMM yyyy', { locale: fr })}`}
              </span>
            </div>

            {/* Navigation de date & Mode */}
            <div className="calendar-nav">
              <div className="calendar-view-mode" style={{ marginRight: '16px' }}>
                <button
                  onClick={() => setViewMode('day')}
                  className={`calendar-view-btn ${viewMode === 'day' ? 'calendar-view-btn--active' : ''}`}
                >
                  Jour
                </button>
                <button
                  onClick={() => setViewMode('week')}
                  className={`calendar-view-btn ${viewMode === 'week' ? 'calendar-view-btn--active' : ''}`}
                >
                  Semaine
                </button>
              </div>

              <button onClick={handlePrev} className="calendar-nav-btn">
                <ChevronLeft size={16} />
              </button>
              <button onClick={handleToday} className="calendar-nav-btn calendar-nav-btn--today">
                Aujourd'hui
              </button>
              <button onClick={handleNext} className="calendar-nav-btn">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Grille d'emploi du temps */}
          {viewMode === 'day' ? (
            <div className="calendar-grid">
              {hours.map((hour) => {
                const slotId = `slot-${format(currentDate, 'yyyy-MM-dd')}-${hour}`;
                const block = timeBlocks.find((tb) => {
                  const tbDate = new Date(tb.startTime);
                  return isSameDay(tbDate, currentDate) && tbDate.getHours() === hour;
                });

                return (
                  <div key={hour} className="calendar-time-row">
                    <span className="calendar-time-label">{formatHour(hour)}</span>
                    <DroppableSlot
                      slotId={slotId}
                      block={block}
                      hour={hour}
                      date={currentDate}
                      isWeekView={false}
                      selectedTaskId={selectedTaskId}
                      onSchedule={handleScheduleTask}
                      onDeleteBlock={deleteTimeBlock}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                overflowX: 'auto',
              }}
            >
              <div className="calendar-grid-week-header">
                <div /> {/* Colonne heure */}
                {weekDays.map((day) => (
                  <div
                    key={day.toString()}
                    className={`calendar-week-header-day ${isToday(day) ? 'calendar-week-header-day--today' : ''}`}
                  >
                    <div>{format(day, 'EEEE', { locale: fr })}</div>
                    <div style={{ fontSize: '18px', fontWeight: 700 }}>{format(day, 'd')}</div>
                  </div>
                ))}
              </div>

              <div className="calendar-grid-week">
                {hours.map((hour) => (
                  <React.Fragment key={hour}>
                    <span className="calendar-time-label" style={{ alignSelf: 'center' }}>
                      {formatHour(hour)}
                    </span>
                    {weekDays.map((day) => {
                      const slotId = `slot-${format(day, 'yyyy-MM-dd')}-${hour}`;
                      const block = timeBlocks.find((tb) => {
                        const tbDate = new Date(tb.startTime);
                        return isSameDay(tbDate, day) && tbDate.getHours() === hour;
                      });

                      return (
                        <DroppableSlot
                          key={day.toString()}
                          slotId={slotId}
                          block={block}
                          hour={hour}
                          date={day}
                          isWeekView={true}
                          selectedTaskId={selectedTaskId}
                          onSchedule={handleScheduleTask}
                          onDeleteBlock={deleteTimeBlock}
                        />
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeDragTaskId
          ? (() => {
              const task = allTasks.find((t) => t.id === activeDragTaskId);
              if (!task) return null;
              return (
                <div
                  className="calendar-unscheduled-card calendar-unscheduled-card--selected"
                  style={{ opacity: 0.9 }}
                >
                  <h5>{task.title}</h5>
                  <span>Priorité : {task.priority}</span>
                </div>
              );
            })()
          : null}
      </DragOverlay>
    </DndContext>
  );
};
