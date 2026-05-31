import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { 
  Activity, 
  TrendingUp, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  ShieldAlert, 
  Compass,
  ArrowUpDown
} from 'lucide-react'
import './PortfolioDashboard.css'

export function PortfolioDashboard() {
  const { projects } = useApp()
  const [sortBy, setSortBy] = useState<'name' | 'health-desc' | 'health-asc' | 'progress-desc' | 'burn-rate'>('health-desc')

  // Calcul du Health Score pour chaque projet
  const projectsWithHealth = useMemo(() => {
    return projects.map(project => {
      const tasks = project.tasks || []
      const totalTasks = tasks.length
      const completedTasks = tasks.filter(t => t.status === 'DONE').length
      
      // Critère 1 : Taux de complétion des tâches (max 40 pts)
      const taskCompletionRate = totalTasks > 0 ? (completedTasks / totalTasks) : 1
      const completionScore = taskCompletionRate * 40

      // Critère 2 : Tâches en retard (max 30 pts, pénalités si en retard)
      // On considère comme en retard une tâche non terminée dont la date de fin (dueDate) est dépassée
      const now = new Date()
      const overdueTasks = tasks.filter(t => {
        if (t.status === 'DONE') return false
        if (!t.dueDate) return false
        return new Date(t.dueDate) < now
      }).length
      
      const overduePenalty = overdueTasks * 8
      const overdueScore = Math.max(0, 30 - overduePenalty)

      // Critère 3 : Respect des jalons / progression globale (max 15 pts)
      // Si un projet a des tâches prioritaires non gérées ou s'il est étiqueté à risque
      let riskPenalty = 0
      if (project.status === 'AT_RISK') riskPenalty += 10
      if (project.status === 'ON_HOLD') riskPenalty += 5
      const riskScore = Math.max(0, 15 - riskPenalty)

      // Critère 4 : Respect du budget (max 15 pts)
      // Mimer la logique financière du backend s'il y a des budgets
      // Pour simuler le burn rate côté UI : si le projet est estimé en heures
      const totalEstimated = tasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0)
      const burnRatePercent = totalEstimated > 0 ? Math.min(150, (completedTasks / totalTasks) * 100) : 0 // simulation
      
      // Si un budget est disponible, on peut l'utiliser
      // Pour la simulation de burn rate, plus on approche de 100% de complétion sans dépasser les coûts, mieux c'est
      let budgetScore = 15
      if (burnRatePercent > 100) {
        budgetScore = Math.max(0, 15 - (burnRatePercent - 100) * 0.3)
      }

      // Health Score final consolidé (sur 100)
      const healthScore = Math.round(completionScore + overdueScore + riskScore + budgetScore)

      // Textes d'analyse IA Mocks locaux très précis
      let assessment = "Le projet progresse de manière saine et les jalons principaux sont respectés."
      let statusClass: 'excellent' | 'good' | 'warning' | 'danger' = 'excellent'
      let statusText = "Excellent"

      if (healthScore >= 85) {
        statusClass = 'excellent'
        statusText = 'Excellent'
        assessment = "Excellente santé opérationnelle. Les tâches sont complétées dans les temps et les risques de retard sont minimes."
      } else if (healthScore >= 70) {
        statusClass = 'good'
        statusText = 'Satisfaisant'
        assessment = "Bonne progression générale. Quelques tâches accusent un léger retard mais l'ensemble reste sous contrôle."
      } else if (healthScore >= 50) {
        statusClass = 'warning'
        statusText = 'À Surveiller'
        assessment = `Attention requise : ${overdueTasks} tâche(s) en retard et une dérive potentielle sur les échéances clés.`
      } else {
        statusClass = 'danger'
        statusText = 'En Alerte'
        assessment = `Projet critique. Taux de complétion faible (${Math.round(taskCompletionRate * 100)}%), plusieurs retards accumulés et budget opérationnel sous haute tension.`
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
        estimatedHours: Number((totalEstimated / 60).toFixed(1)),
        burnRatePercent: Math.round(burnRatePercent)
      }
    })
  }, [projects])

  // KPIs globaux
  const globalStats = useMemo(() => {
    const totalProjects = projectsWithHealth.length
    if (totalProjects === 0) {
      return { count: 0, avgHealth: 0, completedPercent: 0, overdueCount: 0 }
    }

    const sumHealth = projectsWithHealth.reduce((sum, p) => sum + p.healthScore, 0)
    const avgHealth = Math.round(sumHealth / totalProjects)

    const totalTasks = projectsWithHealth.reduce((sum, p) => sum + p.totalTasks, 0)
    const completedTasks = projectsWithHealth.reduce((sum, p) => sum + p.completedTasks, 0)
    const completedPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100

    const overdueCount = projectsWithHealth.reduce((sum, p) => sum + p.overdueTasks, 0)

    return {
      count: totalProjects,
      avgHealth,
      completedPercent,
      overdueCount
    }
  }, [projectsWithHealth])

  // Tri des projets
  const sortedProjects = useMemo(() => {
    const list = [...projectsWithHealth]
    switch (sortBy) {
      case 'name':
        return list.sort((a, b) => a.name.localeCompare(b.name))
      case 'health-desc':
        return list.sort((a, b) => b.healthScore - a.healthScore)
      case 'health-asc':
        return list.sort((a, b) => a.healthScore - b.healthScore)
      case 'progress-desc':
        return list.sort((a, b) => b.taskCompletionRate - a.taskCompletionRate)
      case 'burn-rate':
        return list.sort((a, b) => b.burnRatePercent - a.burnRatePercent)
      default:
        return list
    }
  }, [projectsWithHealth, sortBy])

  // Couleur dynamique du score global
  const getGlobalHealthColor = (score: number) => {
    if (score >= 85) return '#10b981' // excellent
    if (score >= 70) return '#3b82f6' // good
    if (score >= 50) return '#f59e0b' // warning
    return '#ef4444' // danger
  }

  return (
    <div className="portfolio-layout">
      {/* Header section */}
      <div className="portfolio-header-section">
        <div className="portfolio-title-group">
          <div>
            <h2 className="section-title">Tableau de Bord du Portefeuille</h2>
            <p className="portfolio-subtitle">Vue globale de la santé de vos projets et indicateurs clés de performance (KPIs)</p>
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
            <span className="portfolio-kpi-label">Projets Actifs</span>
          </div>
        </div>

        <div className="glass-panel portfolio-kpi-card">
          <div className="portfolio-kpi-icon" style={{ color: getGlobalHealthColor(globalStats.avgHealth) }}>
            <Activity size={24} />
          </div>
          <div className="portfolio-kpi-info">
            <span className="portfolio-kpi-val" style={{ color: getGlobalHealthColor(globalStats.avgHealth) }}>
              {globalStats.avgHealth}%
            </span>
            <span className="portfolio-kpi-label">Score de Santé Moyen</span>
          </div>
        </div>

        <div className="glass-panel portfolio-kpi-card">
          <div className="portfolio-kpi-icon" style={{ color: '#10b981' }}>
            <CheckCircle size={24} />
          </div>
          <div className="portfolio-kpi-info">
            <span className="portfolio-kpi-val">{globalStats.completedPercent}%</span>
            <span className="portfolio-kpi-label">Complétion Tâches</span>
          </div>
        </div>

        <div className="glass-panel portfolio-kpi-card">
          <div className="portfolio-kpi-icon" style={{ color: globalStats.overdueCount > 0 ? '#ef4444' : '#10b981' }}>
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
        <h3 className="widget-title" style={{ margin: 0 }}>Statut de Santé par Projet</h3>
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
            <option value="burn-rate">Consommation ressources</option>
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      {sortedProjects.length === 0 ? (
        <div className="glass-panel empty-state-container" style={{ padding: '40px', textAlign: 'center' }}>
          <Clock size={48} color="var(--text-muted)" style={{ marginBottom: '16px' }} />
          <h3>Aucun projet disponible</h3>
          <p className="portfolio-subtitle">Créez votre premier projet depuis l'onglet Kanban pour activer le tableau de bord.</p>
        </div>
      ) : (
        <div className="portfolio-projects-grid">
          {sortedProjects.map(project => {
            const completionPercent = Math.round(project.taskCompletionRate * 100)
            
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
                    {project.healthScore}
                    <span className="health-score-label">Health</span>
                  </div>
                </div>

                <span className={`project-health-status-desc project-health-status-desc--${project.statusClass}`}>
                  Projet {project.statusText}
                </span>

                {/* Métriques */}
                <div className="project-health-metrics">
                  <div className="health-metric-item">
                    <span className="health-metric-label">Tâches Termines</span>
                    <span className="health-metric-val">
                      <CheckCircle size={12} color="#10b981" /> {project.completedTasks} / {project.totalTasks}
                    </span>
                  </div>
                  
                  <div className="health-metric-item">
                    <span className="health-metric-label">Tâches en Retard</span>
                    <span className={`health-metric-val ${project.overdueTasks > 0 ? 'health-metric-val--alert' : ''}`}>
                      <AlertTriangle size={12} /> {project.overdueTasks}
                    </span>
                  </div>

                  <div className="health-metric-item">
                    <span className="health-metric-label">Volume Estimé</span>
                    <span className="health-metric-val">
                      <Clock size={12} /> {project.estimatedHours} h
                    </span>
                  </div>

                  <div className="health-metric-item">
                    <span className="health-metric-label">Burn Rate</span>
                    <span className="health-metric-val">
                      <TrendingUp size={12} /> {project.burnRatePercent}%
                    </span>
                  </div>
                </div>

                {/* Barres de progression */}
                <div className="project-health-progress-section">
                  <div className="health-progress-bar-group">
                    <div className="health-progress-bar-header">
                      <span>Avancement des tâches</span>
                      <span>{completionPercent}%</span>
                    </div>
                    <div className="health-progress-bar-bg">
                      <div 
                        className="health-progress-bar-fill" 
                        style={{ 
                          width: `${completionPercent}%`,
                          background: project.healthScore >= 70 ? 'linear-gradient(90deg, #10B981, #059669)' : 'linear-gradient(90deg, #F59E0B, #D97706)' 
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* IA / Local Assessment Report */}
                <div className="project-health-assessment">
                  <div className="project-health-assessment-icon">
                    <ShieldAlert size={14} color={project.healthScore < 50 ? '#ef4444' : 'var(--accent-primary)'} />
                  </div>
                  <div className="project-health-assessment-text">
                    <strong>Rapport d'évaluation :</strong> {project.assessment}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
