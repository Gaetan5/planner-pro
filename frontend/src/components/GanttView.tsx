import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp, Task } from '../context/AppContext';
import { CalendarRange, ZoomIn, ZoomOut, AlertCircle, Link } from 'lucide-react';
import './GanttView.css';

export const GanttView: React.FC = () => {
  const { workspaces, projects, updateTask, addTaskDependency, removeTaskDependency, refreshData } =
    useApp();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('');
  const [zoomMode, setZoomMode] = useState<'day' | 'week'>('day');
  const [timelineStartDate, setTimelineStartDate] = useState<Date>(new Date());
  const [timelineEndDate, setTimelineEndDate] = useState<Date>(new Date());
  const [datesArray, setDatesArray] = useState<Date[]>([]);
  const [showCriticalPath, setShowCriticalPath] = useState<boolean>(false);
  const [criticalTaskIds, setCriticalTaskIds] = useState<string[]>([]);

  // Drag & drop interaction states
  const [interaction, setInteraction] = useState<{
    type: 'move' | 'resize-start' | 'resize-end';
    taskId: string;
    initialStartX: number;
    initialStartDate: Date;
    initialDueDate: Date;
    taskDurationMs: number;
  } | null>(null);

  // Drag preview offset for UI feedback before saving to database
  const [dragPreview, setDragPreview] = useState<{
    taskId: string;
    deltaDaysStart: number;
    deltaDaysDue: number;
  } | null>(null);

  // Dependency creation state
  const [linkingTaskId, setLinkingTaskId] = useState<string | null>(null);

  const timelineScrollRef = useRef<HTMLDivElement>(null);

  // Cell width based on zoom
  const cellWidth = zoomMode === 'day' ? 42 : 110;

  // Set initial active workspace
  useEffect(() => {
    if (workspaces.length > 0 && !activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0].id);
    }
  }, [workspaces]);

  // Get tasks for active workspace
  const workspaceProjects = useMemo(() => {
    return projects.filter((p) => p.workspaceId === activeWorkspaceId);
  }, [projects, activeWorkspaceId]);

  const allTasks = useMemo(() => {
    return workspaceProjects.flatMap((p) =>
      (p.tasks || []).map((t) => ({ ...t, projectName: p.name })),
    );
  }, [workspaceProjects]);

  // Generate timeline range based on tasks dates
  useEffect(() => {
    if (allTasks.length === 0) {
      const start = new Date();
      start.setDate(start.getDate() - 5);
      const end = new Date();
      end.setDate(end.getDate() + 25);
      setTimelineStartDate(start);
      setTimelineEndDate(end);
      return;
    }

    // Find min start date and max due date
    let minDateMs = Infinity;
    let maxDateMs = -Infinity;

    allTasks.forEach((task) => {
      if (task.startDate) {
        const ms = new Date(task.startDate).getTime();
        if (ms < minDateMs) minDateMs = ms;
      }
      if (task.dueDate) {
        const ms = new Date(task.dueDate).getTime();
        if (ms > maxDateMs) maxDateMs = ms;
      }
    });

    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (minDateMs === Infinity) {
      start.setDate(now.getDate() - 5);
    } else {
      start = new Date(minDateMs);
      start.setDate(start.getDate() - 7); // 7 days margin before
    }

    if (maxDateMs === -Infinity) {
      end.setDate(now.getDate() + 25);
    } else {
      end = new Date(maxDateMs);
      end.setDate(end.getDate() + 15); // 15 days margin after
    }

    // Truncate to hours to avoid timezone shifts
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    setTimelineStartDate(start);
    setTimelineEndDate(end);
  }, [activeWorkspaceId, projects]);

  // Generate grid dates array
  useEffect(() => {
    const dates: Date[] = [];
    const current = new Date(timelineStartDate);
    const end = new Date(timelineEndDate);

    if (zoomMode === 'day') {
      while (current <= end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
    } else {
      // Week mode: align on Mondays
      const day = current.getDay();
      const diff = current.getDate() - day + (day === 0 ? -6 : 1); // adjust to monday
      current.setDate(diff);

      while (current <= end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 7);
      }
    }
    setDatesArray(dates);
  }, [timelineStartDate, timelineEndDate, zoomMode]);

  const { getProjectCriticalPath } = useApp();

  useEffect(() => {
    if (!showCriticalPath || workspaceProjects.length === 0) {
      setCriticalTaskIds([]);
      return;
    }

    const fetchCriticalPaths = async () => {
      let allCriticalIds: string[] = [];
      for (const proj of workspaceProjects) {
        try {
          const pathRes = await getProjectCriticalPath(proj.id);
          if (pathRes) {
            allCriticalIds = [...allCriticalIds, ...pathRes.criticalTaskIds];
          }
        } catch (err) {
          console.error('Error fetching critical path for project', proj.id, err);
        }
      }
      setCriticalTaskIds(allCriticalIds);
    };

    fetchCriticalPaths();
  }, [showCriticalPath, activeWorkspaceId, projects]);

  // Scroll timeline to today initially
  useEffect(() => {
    if (timelineScrollRef.current && datesArray.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const index = datesArray.findIndex((d) => {
        const dateTrunc = new Date(d);
        dateTrunc.setHours(0, 0, 0, 0);
        return dateTrunc.getTime() >= today.getTime();
      });
      if (index !== -1) {
        timelineScrollRef.current.scrollLeft = Math.max(0, index * cellWidth - 150);
      }
    }
  }, [datesArray]);

  // Convert Date to column offset in pixels
  const getXPosition = (dateStr: string | undefined): number => {
    if (!dateStr) return 0;
    const date = new Date(dateStr);
    const start = new Date(timelineStartDate);

    const diffMs = date.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (zoomMode === 'day') {
      return diffDays * cellWidth;
    } else {
      return (diffDays / 7) * cellWidth;
    }
  };

  // Get Gantt bar dimensions and style for a task
  const getTaskBarCoords = (task: Task) => {
    // If previewing drag, apply temporary offsets
    const isThisTaskPreview = dragPreview && dragPreview.taskId === task.id;

    const startStr = task.startDate;
    const dueStr = task.dueDate;

    if (!startStr || !dueStr) return null;

    let startDate = new Date(startStr);
    let dueDate = new Date(dueStr);

    if (isThisTaskPreview && dragPreview) {
      startDate.setDate(startDate.getDate() + dragPreview.deltaDaysStart);
      dueDate.setDate(dueDate.getDate() + dragPreview.deltaDaysDue);
    }

    const left = getXPosition(startDate.toISOString());
    const right = getXPosition(dueDate.toISOString());
    const width = Math.max(24, right - left); // Min width

    return { left, width };
  };

  // Start interaction (move or resize)
  const handleInteractionStart = (
    e: React.MouseEvent,
    taskId: string,
    type: 'move' | 'resize-start' | 'resize-end',
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const task = allTasks.find((t) => t.id === taskId);
    if (!task || !task.startDate || !task.dueDate) return;

    setInteraction({
      type,
      taskId,
      initialStartX: e.clientX,
      initialStartDate: new Date(task.startDate),
      initialDueDate: new Date(task.dueDate),
      taskDurationMs: new Date(task.dueDate).getTime() - new Date(task.startDate).getTime(),
    });

    setDragPreview({
      taskId,
      deltaDaysStart: 0,
      deltaDaysDue: 0,
    });
  };

  // Handle global move
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!interaction) return;

      const deltaX = e.clientX - interaction.initialStartX;
      const pxPerDay = zoomMode === 'day' ? cellWidth : cellWidth / 7;
      const deltaDays = Math.round(deltaX / pxPerDay);

      if (interaction.type === 'move') {
        setDragPreview({
          taskId: interaction.taskId,
          deltaDaysStart: deltaDays,
          deltaDaysDue: deltaDays,
        });
      } else if (interaction.type === 'resize-start') {
        // Limit start to not exceed due date
        const maxDelta = Math.floor(
          (interaction.initialDueDate.getTime() -
            interaction.initialStartDate.getTime() -
            1000 * 60 * 60 * 24) /
            (1000 * 60 * 60 * 24),
        );
        const finalDelta = Math.min(deltaDays, maxDelta);
        setDragPreview({
          taskId: interaction.taskId,
          deltaDaysStart: finalDelta,
          deltaDaysDue: 0,
        });
      } else if (interaction.type === 'resize-end') {
        // Limit end to not be prior to start date
        const minDelta = Math.ceil(
          (interaction.initialStartDate.getTime() -
            interaction.initialDueDate.getTime() +
            1000 * 60 * 60 * 24) /
            (1000 * 60 * 60 * 24),
        );
        const finalDelta = Math.max(deltaDays, minDelta);
        setDragPreview({
          taskId: interaction.taskId,
          deltaDaysStart: 0,
          deltaDaysDue: finalDelta,
        });
      }
    };

    const handleMouseUp = async () => {
      if (!interaction || !dragPreview) return;

      const task = allTasks.find((t) => t.id === interaction.taskId);
      if (task && task.startDate && task.dueDate) {
        const newStart = new Date(task.startDate);
        const newDue = new Date(task.dueDate);

        newStart.setDate(newStart.getDate() + dragPreview.deltaDaysStart);
        newDue.setDate(newDue.getDate() + dragPreview.deltaDaysDue);

        // Only save if dates actually changed
        if (dragPreview.deltaDaysStart !== 0 || dragPreview.deltaDaysDue !== 0) {
          try {
            await updateTask(task.id, {
              startDate: newStart.toISOString(),
              dueDate: newDue.toISOString(),
            });
            await refreshData();
          } catch (err) {
            console.error('Erreur lors du déplacement de la tâche :', err);
            alert('Échec de la replanification de la tâche.');
          }
        }
      }

      setInteraction(null);
      setDragPreview(null);
    };

    if (interaction) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [interaction, dragPreview, zoomMode]);

  // Manage dependency drawing paths
  const [linksPaths, setLinksPaths] = useState<
    { path: string; hasConflict: boolean; key: string; fromTaskId: string; toTaskId: string }[]
  >([]);

  useEffect(() => {
    const paths: typeof linksPaths = [];

    allTasks.forEach((task, taskIndex) => {
      if (!task.startDate || !task.dueDate || !task.dependencies) return;

      const taskCoords = getTaskBarCoords(task);
      if (!taskCoords) return;

      task.dependencies.forEach((dep) => {
        const parentTask = allTasks.find((t) => t.id === dep.dependsOnTaskId);
        if (!parentTask || !parentTask.startDate || !parentTask.dueDate) return;

        const parentCoords = getTaskBarCoords(parentTask);
        if (!parentCoords) return;

        const parentIndex = allTasks.findIndex((t) => t.id === parentTask.id);
        if (parentIndex === -1) return;

        // Calculate Y coordinates based on task index (each row has height 56px)
        const rowHeight = 56;
        const taskBarHeight = 32;
        const gridHeaderHeight = 56;

        const yParent = gridHeaderHeight + parentIndex * rowHeight + taskBarHeight / 2;
        const yTask = gridHeaderHeight + taskIndex * rowHeight + taskBarHeight / 2;

        const xParentEnd = parentCoords.left + parentCoords.width;
        const xTaskStart = taskCoords.left;

        // Check if there is a scheduling conflict (dependent task starts before parent ends)
        const hasConflict = new Date(task.startDate!) < new Date(parentTask.dueDate!);

        // Draw standard S-curve / Polyline path
        const xMid = xParentEnd + 12;
        const path =
          `M ${xParentEnd} ${yParent} ` +
          `L ${xMid} ${yParent} ` +
          `L ${xMid} ${yTask} ` +
          `L ${xTaskStart} ${yTask}`;

        paths.push({
          path,
          hasConflict,
          key: `${parentTask.id}-${task.id}`,
          fromTaskId: parentTask.id,
          toTaskId: task.id,
        });
      });
    });

    setLinksPaths(paths);
  }, [allTasks, zoomMode, dragPreview, timelineStartDate]);

  // Create task dependency trigger
  const handleLinkClick = async (targetTaskId: string) => {
    if (!linkingTaskId) {
      setLinkingTaskId(targetTaskId);
      return;
    }

    if (linkingTaskId === targetTaskId) {
      setLinkingTaskId(null);
      return;
    }

    try {
      await addTaskDependency(linkingTaskId, targetTaskId, 'FINISH_TO_START');
      alert('Lien de dépendance Gantt créé avec succès !');
      setLinkingTaskId(null);
      await refreshData();
    } catch (err: any) {
      alert(err.message || 'Impossible de créer la dépendance (boucle circulaire détectée).');
      setLinkingTaskId(null);
    }
  };

  // Remove dependency helper
  const handleRemoveLink = async (taskId: string, parentTaskId: string) => {
    if (confirm('Voulez-vous supprimer cette liaison de dépendance ?')) {
      try {
        await removeTaskDependency(taskId, parentTaskId);
        await refreshData();
      } catch (err) {
        alert('Erreur lors de la suppression de la dépendance.');
      }
    }
  };

  return (
    <div className="gantt-view-container">
      {/* Header Gantt */}
      <div className="gantt-header glass-panel">
        <div className="gantt-header-title-container">
          <CalendarRange className="gantt-icon-sparkle" size={24} />
          <div>
            <h1 className="gantt-title">Diagramme de Gantt Interactif</h1>
            <p className="gantt-subtitle">
              Ajustez vos plannings visuellement & propagez automatiquement le travail
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="gantt-header-controls">
          <div className="control-group">
            <label className="control-label">Espace :</label>
            <select
              value={activeWorkspaceId}
              onChange={(e) => setActiveWorkspaceId(e.target.value)}
              className="gantt-select"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="zoom-toggle-group">
            <button
              onClick={() => setZoomMode('day')}
              className={`zoom-btn ${zoomMode === 'day' ? 'zoom-btn--active' : ''}`}
            >
              <ZoomIn size={14} /> Jours
            </button>
            <button
              onClick={() => setZoomMode('week')}
              className={`zoom-btn ${zoomMode === 'week' ? 'zoom-btn--active' : ''}`}
            >
              <ZoomOut size={14} /> Semaines
            </button>
            <button
              onClick={() => setShowCriticalPath(!showCriticalPath)}
              className={`zoom-btn ${showCriticalPath ? 'zoom-btn--active-critical' : ''}`}
              style={{
                marginLeft: '8px',
                borderColor: showCriticalPath ? '#ef4444' : undefined,
                color: showCriticalPath ? '#ef4444' : undefined,
                backgroundColor: showCriticalPath ? 'rgba(239, 68, 68, 0.1)' : undefined,
              }}
            >
              <AlertCircle size={14} /> Chemin Critique
            </button>
          </div>
        </div>
      </div>

      {/* Info conflict bar if any */}
      {allTasks.some((t) =>
        t.dependencies?.some((d) => {
          const parent = allTasks.find((pt) => pt.id === d.dependsOnTaskId);
          return parent && new Date(t.startDate!) < new Date(parent.dueDate!);
        }),
      ) && (
        <div className="gantt-conflict-banner glass-panel">
          <AlertCircle size={16} className="conflict-banner-icon" />
          <span>
            Certaines tâches commencent avant la fin de leur prédécesseur. Les dépendances en
            conflit clignotent en rouge.
          </span>
        </div>
      )}

      {/* Main Gantt Grid Layout */}
      <div className="gantt-layout-grid glass-panel">
        {/* LEFT COLUMN: TASK METADATA LIST */}
        <div className="gantt-left-panel">
          <div className="panel-header-cell">Tâches</div>
          <div className="panel-tasks-list">
            {allTasks.length === 0 ? (
              <div className="empty-gantt-tasks">Aucune tâche planifiée.</div>
            ) : (
              allTasks.map((task) => (
                <div key={task.id} className="task-meta-row">
                  <div className="task-meta-left">
                    <span
                      className={`task-status-dot task-status-dot--${task.status.toLowerCase()}`}
                    ></span>
                    <span className="task-meta-title" title={task.title}>
                      {task.title}
                    </span>
                  </div>
                  <div className="task-meta-actions">
                    <button
                      onClick={() => handleLinkClick(task.id)}
                      className={`btn-action-link ${linkingTaskId === task.id ? 'btn-action-link--linking' : ''}`}
                      title={
                        linkingTaskId
                          ? 'Sélectionner la tâche parente'
                          : 'Lier cette tâche à une autre'
                      }
                    >
                      <Link size={12} />
                    </button>
                    {task.dependencies && task.dependencies.length > 0 && (
                      <div className="dep-tags-container">
                        {task.dependencies.map((d) => (
                          <span
                            key={d.id}
                            className="dep-tag"
                            onClick={() => handleRemoveLink(task.id, d.dependsOnTaskId)}
                            title="Cliquez pour supprimer le lien"
                          >
                            préd.
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: HORIZONTAL SCROLL TIMELINE */}
        <div className="gantt-right-panel" ref={timelineScrollRef}>
          {/* Timeline Header Dates */}
          <div className="gantt-timeline-header" style={{ width: datesArray.length * cellWidth }}>
            {datesArray.map((date, idx) => {
              const dayNum = date.getDate();
              const monthStr = date.toLocaleDateString('fr-FR', { month: 'short' });
              const isToday = new Date().toDateString() === date.toDateString();

              return (
                <div
                  key={idx}
                  className={`header-date-cell ${isToday ? 'header-date-cell--today' : ''}`}
                  style={{ width: cellWidth }}
                >
                  {zoomMode === 'day' ? (
                    <>
                      <span className="day-num">{dayNum}</span>
                      <span className="month-label">{monthStr}</span>
                    </>
                  ) : (
                    <span className="week-label">
                      S. {Math.ceil(dayNum / 7) + date.getMonth() * 4}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Timeline Tasks Rows Container */}
          <div className="gantt-timeline-body" style={{ width: datesArray.length * cellWidth }}>
            {/* SVG Overlays for Dependency Lines */}
            <svg
              className="gantt-svg-overlay"
              style={{
                width: datesArray.length * cellWidth,
                height: gridHeaderHeight + allTasks.length * 56,
              }}
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="var(--arrow-color)" />
                </marker>
                <marker
                  id="arrow-conflict"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#ef4444" />
                </marker>
                <marker
                  id="arrow-critical"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#f43f5e" />
                </marker>
              </defs>
              {linksPaths.map((link) => (
                <path
                  key={link.key}
                  d={link.path}
                  className={`dependency-svg-path ${link.hasConflict ? 'dependency-svg-path--conflict' : ''} ${showCriticalPath && criticalTaskIds.includes(link.fromTaskId) && criticalTaskIds.includes(link.toTaskId) ? 'dependency-svg-path--critical' : ''}`}
                  markerEnd={
                    link.hasConflict
                      ? 'url(#arrow-conflict)'
                      : showCriticalPath &&
                          criticalTaskIds.includes(link.fromTaskId) &&
                          criticalTaskIds.includes(link.toTaskId)
                        ? 'url(#arrow-critical)'
                        : 'url(#arrow)'
                  }
                  style={
                    {
                      '--arrow-color':
                        showCriticalPath &&
                        criticalTaskIds.includes(link.fromTaskId) &&
                        criticalTaskIds.includes(link.toTaskId)
                          ? '#f43f5e'
                          : 'rgba(139, 92, 246, 0.7)',
                    } as React.CSSProperties
                  }
                />
              ))}
            </svg>

            {/* Vertical grid lines */}
            <div className="gantt-vertical-grid-lines">
              {datesArray.map((_, idx) => (
                <div key={idx} className="vertical-grid-line" style={{ width: cellWidth }}></div>
              ))}
            </div>

            {/* Tasks rows */}
            {allTasks.map((task) => {
              const coords = getTaskBarCoords(task);
              const hasDates = task.startDate && task.dueDate;

              return (
                <div key={task.id} className="gantt-task-row">
                  {hasDates && coords ? (
                    <div
                      className={`gantt-task-bar status--${task.status.toLowerCase()} priority--${task.priority.toLowerCase()} ${showCriticalPath && criticalTaskIds.includes(task.id) ? 'gantt-task-bar--critical' : ''}`}
                      style={{
                        left: coords.left,
                        width: coords.width,
                      }}
                      onMouseDown={(e) => handleInteractionStart(e, task.id, 'move')}
                    >
                      {/* Left Resize Handle */}
                      <div
                        className="resize-handle resize-handle--left"
                        onMouseDown={(e) => handleInteractionStart(e, task.id, 'resize-start')}
                      ></div>

                      {/* Bar Center Label */}
                      <span className="task-bar-label">{task.title}</span>

                      {/* Right Resize Handle */}
                      <div
                        className="resize-handle resize-handle--right"
                        onMouseDown={(e) => handleInteractionStart(e, task.id, 'resize-end')}
                      ></div>
                    </div>
                  ) : (
                    <div
                      className="gantt-task-bar-unplanned"
                      onClick={async () => {
                        const today = new Date();
                        const end = new Date();
                        end.setDate(end.getDate() + 2);
                        await updateTask(task.id, {
                          startDate: today.toISOString(),
                          dueDate: end.toISOString(),
                        });
                        await refreshData();
                      }}
                      title="Cliquez pour planifier automatiquement à partir de aujourd'hui"
                    >
                      Non planifiée. Cliquer pour planifier (2 jours)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper gridHeaderHeight variable matching row heights
const gridHeaderHeight = 56;
