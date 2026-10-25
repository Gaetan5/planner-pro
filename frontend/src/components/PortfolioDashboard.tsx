import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  Activity,
  CheckCircle,
  AlertTriangle,
  Clock,
  ShieldAlert,
  Compass,
  ArrowUpDown,
} from 'lucide-react';
import './PortfolioDashboard.css';

export function PortfolioDashboard() {
  const { projects } = useApp();
  const [sortBy, setSortBy] = useState<
    'name' | 'health-desc' | 'health-asc' | 'progress-desc' | 'overdue-desc'
  >('health-desc');

  // Calcul du Health Score pour chaque projet
  const projectsWithHealth = useMemo(() => {
    return projects.map((project) => {
      const tasks = project.tasks || [];
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t) => t.status === 'DONE').length;
      const taskCompletionRate = totalTasks > 0 ? completedTasks / totalTasks : null;
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const overdueTasks = tasks.filter((t) => {
        if (t.status === 'DONE') return false;
        if (!t.dueDate) return false;
        const dueDate = new Date(t.dueDate);
        if (Number.isNaN(dueDate.getTime())) return false;
        const dueDay = /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)
          ? t.dueDate
          : `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
        return dueDay < today;
      }).length;

      let riskPenalty = 0;
      if (project.status === 'AT_RISK') riskPenalty += 10;
      if (project.status === 'ON_HOLD') riskPenalty += 5;
      const riskScore = Math.max(0, 15 - riskPenalty);

      const estimatedMinutes = tasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
      const healthScore =
        taskCompletionRate === null
          ? null
          : Math.round(
              ((taskCompletionRate * 40 + Math.max(0, 30 - overdueTasks * 8) + riskScore) / 85) *
                100,
            );

      let assessment: string;
      let statusClass: 'excellent' | 'good' | 'warning' | 'danger' | 'unknown';
      let statusText: string;

      if (healthScore === null) {
        statusClass = 'unknown';
        statusText = 'Non évalué';
        assessment = 'Ajoutez des tâches pour calculer les indicateurs de suivi de ce projet.';
      } else if (healthScore >= 85) {
        statusClass = 'excellent';
        statusText = 'Excellent';
        assessment =
          'Bon niveau de suivi selon l’avancement des tâches, les échéances et le statut du projet.';
      } else if (healthScore >= 70) {
        statusClass = 'good';
        statusText = 'Satisfaisant';
        assessment = 'Progression à suivre : vérifiez les tâches en retard et le statut du projet.';
      } else if (healthScore >= 50) {
        statusClass = 'warning';
        statusText = 'À Surveiller';
        assessment = `Attention requise : ${overdueTasks} tâche(s) en retard ou un statut projet à risque.`;
      } else {
        statusClass = 'danger';
        statusText = 'En Alerte';
        assessment = `Suivi dégradé : ${overdueTasks} tâche(s) en retard et faible avancement des tâches.`;
      }

      return {
        ...project,
        totalTasks,
        completedTasks,
        overdueTasks,
        healthScore,
        taskCompletionRate,
        statusClass,
        statusText,
        assessment,
        estimatedHours: Number((estimatedMinutes / 60).toFixed(1)),
      };
    });
  }, [projects]);

  // KPIs globaux
  const globalStats = useMemo(() => {
    const totalProjects = projectsWithHealth.length;
    if (totalProjects === 0) {
      return { count: 0, avgHealth: null, completedPercent: null, overdueCount: 0 };
    }

    const assessedProjects = projectsWithHealth.filter((project) => project.healthScore !== null);
    const sumHealth = assessedProjects.reduce(
      (sum, project) => sum + (project.healthScore ?? 0),
      0,
    );
    const avgHealth =
      assessedProjects.length > 0 ? Math.round(sumHealth / assessedProjects.length) : null;

    const totalTasks = projectsWithHealth.reduce((sum, p) => sum + p.totalTasks, 0);
    const completedTasks = projectsWithHealth.reduce((sum, p) => sum + p.completedTasks, 0);
    const completedPercent =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : null;

    const overdueCount = projectsWithHealth.reduce((sum, p) => sum + p.overdueTasks, 0);

    return {
      count: totalProjects,
      avgHealth,
      completedPercent,
      overdueCount,
    };
  }, [projectsWithHealth]);

  // Tri des projets
  const sortedProjects = useMemo(() => {
    const list = [...projectsWithHealth];
    switch (sortBy) {
      case 'name':
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case 'health-desc':
        return list.sort((a, b) => (b.healthScore ?? -1) - (a.healthScore ?? -1));
      case 'health-asc':
        return list.sort(
          (a, b) => (a.healthScore ?? Number.MAX_VALUE) - (b.healthScore ?? Number.MAX_VALUE),
        );
      case 'progress-desc':
        return list.sort((a, b) => (b.taskCompletionRate ?? -1) - (a.taskCompletionRate ?? -1));
      case 'overdue-desc':
        return list.sort((a, b) => b.overdueTasks - a.overdueTasks);
      default:
        return list;
    }
  }, [projectsWithHealth, sortBy]);

  // Couleur dynamique du score global
  const getGlobalHealthColor = (score: number | null) => {
    if (score === null) return 'var(--text-muted)';
    if (score >= 85) return '#10b981'; // excellent
    if (score >= 70) return '#3b82f6'; // good
    if (score >= 50) return '#f59e0b'; // warning
    return '#ef4444'; // danger
  };

  return (
    <div className="portfolio-layout">
      {/* Header section */}
      <div className="portfolio-header-section">
        <div className="portfolio-title-group">
          <div>
            <h2 className="section-title">Tableau de Bord du Portefeuille</h2>
            <p className="portfolio-subtitle">
              Suivi calculé à partir de l’avancement, des échéances et du statut. Les budgets ne
              sont pas intégrés à ce score.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="portfolio-kpi-grid">
        <div className="glass-panel portfolio-kpi-card">
          <div className="portfolio-kpi-icon">
            <Compass size={24} />
          </div>
          <div className="portfolio-kpi-info">
            <span className="portfolio-kpi-val">{globalStats.count}</span>
            <span className="portfolio-kpi-label">Projets du portefeuille</span>
          </div>
        </div>

        <div className="glass-panel portfolio-kpi-card">
          <div
            className="portfolio-kpi-icon"
            style={{ color: getGlobalHealthColor(globalStats.avgHealth) }}
          >
            <Activity size={24} />
          </div>
          <div className="portfolio-kpi-info">
            <span
              className="portfolio-kpi-val"
              style={{ color: getGlobalHealthColor(globalStats.avgHealth) }}
            >
              {globalStats.avgHealth === null ? '—' : `${globalStats.avgHealth}%`}
            </span>
            <span className="portfolio-kpi-label">Score de suivi moyen</span>
          </div>
        </div>

        <div className="glass-panel portfolio-kpi-card">
          <div className="portfolio-kpi-icon" style={{ color: '#10b981' }}>
            <CheckCircle size={24} />
          </div>
          <div className="portfolio-kpi-info">
            <span className="portfolio-kpi-val">
              {globalStats.completedPercent === null ? '—' : `${globalStats.completedPercent}%`}
            </span>
            <span className="portfolio-kpi-label">Complétion Tâches</span>
          </div>
        </div>

        <div className="glass-panel portfolio-kpi-card">
          <div
            className="portfolio-kpi-icon"
            style={{ color: globalStats.overdueCount > 0 ? '#ef4444' : '#10b981' }}
          >
            <AlertTriangle size={24} />
          </div>
          <div className="portfolio-kpi-info">
            <span className="portfolio-kpi-val">{globalStats.overdueCount}</span>
            <span className="portfolio-kpi-label">Tâches en Retard</span>
          </div>
        </div>
      </div>

      {/* Controls & Filter bar */}
      <div className="portfolio-controls">
        <h3 className="widget-title" style={{ margin: 0 }}>
          Statut de Santé par Projet
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ArrowUpDown size={14} color="var(--text-muted)" />
          <select
            className="portfolio-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
          >
            <option value="health-desc">Santé décroissante</option>
            <option value="health-asc">Santé croissante</option>
            <option value="name">Nom du projet</option>
            <option value="progress-desc">Progression tâches</option>
            <option value="overdue-desc">Tâches en retard</option>
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      {sortedProjects.length === 0 ? (
        <div
          className="glass-panel empty-state-container"
          style={{ padding: '40px', textAlign: 'center' }}
        >
          <Clock size={48} color="var(--text-muted)" style={{ marginBottom: '16px' }} />
          <h3>Aucun projet disponible</h3>
          <p className="portfolio-subtitle">
            Créez votre premier projet depuis l'onglet Kanban pour activer le tableau de bord.
          </p>
        </div>
      ) : (
        <div className="portfolio-projects-grid">
          {sortedProjects.map((project) => {
            const completionPercent =
              project.taskCompletionRate === null
                ? null
                : Math.round(project.taskCompletionRate * 100);

            return (
              <div key={project.id} className="glass-panel project-health-card">
                {/* Header carte */}
                <div className="project-health-card__header">
                  <div className="project-health-card__title-group">
                    <h4 className="project-health-card__title">{project.name}</h4>
                    <span className="project-health-card__subtitle">
                      ID: {project.id.slice(0, 8)}... | Statut : {project.status || 'ACTIVE'}
                    </span>
                  </div>

                  {/* Badge score */}
                  <div className={`health-score-badge health-score-badge--${project.statusClass}`}>
                    {project.healthScore ?? '—'}
                    <span className="health-score-label">Suivi</span>
                  </div>
                </div>

                <span
                  className={`project-health-status-desc project-health-status-desc--${project.statusClass}`}
                >
                  Projet {project.statusText}
                </span>

                {/* Métriques */}
                <div className="project-health-metrics">
                  <div className="health-metric-item">
                    <span className="health-metric-label">Tâches Termines</span>
                    <span className="health-metric-val">
                      <CheckCircle size={12} color="#10b981" /> {project.completedTasks} /{' '}
                      {project.totalTasks}
                    </span>
                  </div>

                  <div className="health-metric-item">
                    <span className="health-metric-label">Tâches en Retard</span>
                    <span
                      className={`health-metric-val ${project.overdueTasks > 0 ? 'health-metric-val--alert' : ''}`}
                    >
                      <AlertTriangle size={12} /> {project.overdueTasks}
                    </span>
                  </div>

                  <div className="health-metric-item">
                    <span className="health-metric-label">Volume Estimé</span>
                    <span className="health-metric-val">
                      <Clock size={12} /> {project.estimatedHours} h
                    </span>
                  </div>
                </div>

                {/* Barres de progression */}
                <div className="project-health-progress-section">
                  <div className="health-progress-bar-group">
                    <div className="health-progress-bar-header">
                      <span>Avancement des tâches</span>
                      <span>{completionPercent === null ? '—' : `${completionPercent}%`}</span>
                    </div>
                    <div className="health-progress-bar-bg">
                      <div
                        className="health-progress-bar-fill"
                        style={{
                          width: `${completionPercent ?? 0}%`,
                          background:
                            (project.healthScore ?? 0) >= 70
                              ? 'linear-gradient(90deg, #10B981, #059669)'
                              : 'linear-gradient(90deg, #F59E0B, #D97706)',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* IA / Local Assessment Report */}
                <div className="project-health-assessment">
                  <div className="project-health-assessment-icon">
                    <ShieldAlert
                      size={14}
                      color={(project.healthScore ?? 0) < 50 ? '#ef4444' : 'var(--accent-primary)'}
                    />
                  </div>
                  <div className="project-health-assessment-text">
                    <strong>Rapport d'évaluation :</strong> {project.assessment}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
