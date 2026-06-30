import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  PiggyBank,
  BarChart3,
} from 'lucide-react';
import './FinancesView.css';

interface ProjectFinance {
  projectId: string;
  projectName: string;
  billingType: string;
  budgetCents: number | null;
  totalHours: number;
  actualCostCents: number;
  actualRevenueCents: number;
  marginCents: number;
  marginPercent: number;
  burnPercent: number;
  hasBudgetAlert: boolean;
}

interface WorkspaceSummary {
  workspaceId: string;
  totalBudget: number;
  totalCost: number;
  totalRevenue: number;
  totalMargin: number;
  totalMarginPercent: number;
  totalHours: number;
  projects: ProjectFinance[];
}

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const formatCurrency = (cents: number) => {
  const abs = Math.abs(cents);
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs / 100);
  return cents < 0 ? `-${formatted} €` : `${formatted} €`;
};

export const FinancesView: React.FC = () => {
  const { user, workspaces } = useApp();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: user?.token ? `Bearer ${user.token}` : '',
    }),
    [user?.token],
  );

  const loadFinances = useCallback(async () => {
    if (!user || workspaces.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const workspaceId = workspaces[0].id;
      const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/finances`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      } else if (res.status === 403) {
        setError('Accès restreint : droits Admin ou Owner requis pour consulter les finances.');
      } else {
        setError('Erreur lors du chargement des données financières.');
      }
    } catch (e) {
      setError('Impossible de contacter le serveur.');
    } finally {
      setLoading(false);
    }
  }, [user, workspaces, getHeaders]);

  useEffect(() => {
    loadFinances();
  }, [loadFinances]);

  if (loading) {
    return (
      <div className="finances-layout">
        <div className="glass-panel finances-loading">
          <div className="finances-loading__spinner" />
          Chargement des données financières…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="finances-layout">
        <div className="glass-panel finances-empty">
          <AlertTriangle size={40} className="finances-empty__icon" />
          <span className="finances-empty__text">{error}</span>
        </div>
      </div>
    );
  }

  if (!summary || summary.projects.length === 0) {
    return (
      <div className="finances-layout">
        <div className="finances-header">
          <div className="finances-header__left">
            <DollarSign size={28} color="var(--accent-primary)" />
            <div>
              <h2 className="finances-header__title">Finances</h2>
              <p className="finances-header__subtitle">Vue financière du workspace</p>
            </div>
          </div>
        </div>
        <div className="glass-panel finances-empty">
          <PiggyBank size={48} className="finances-empty__icon" />
          <span className="finances-empty__text">Aucune donnée financière disponible</span>
          <span className="finances-empty__hint">
            Les données financières apparaîtront lorsque vos projets auront un budget défini, des
            profils de ressources avec des taux horaires, et du temps logué sur les tâches.
          </span>
        </div>
      </div>
    );
  }

  const getBurnClass = (percent: number) => {
    if (percent > 100) return 'finances-burn-bar__fill--danger';
    if (percent > 75) return 'finances-burn-bar__fill--warning';
    return 'finances-burn-bar__fill--safe';
  };

  return (
    <div className="finances-layout">
      {/* Header */}
      <div className="finances-header">
        <div className="finances-header__left">
          <DollarSign size={28} color="var(--accent-primary)" />
          <div>
            <h2 className="finances-header__title">Finances</h2>
            <p className="finances-header__subtitle">Vue financière consolidée du workspace</p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="finances-summary-grid">
        <div className="glass-panel finances-summary-card finances-summary-card--revenue">
          <span className="finances-summary-card__label">Chiffre d'affaires</span>
          <span className="finances-summary-card__value">
            {formatCurrency(summary.totalRevenue)}
          </span>
          <span className="finances-summary-card__badge finances-summary-card__badge--neutral">
            <BarChart3 size={10} /> {summary.projects.length} projet
            {summary.projects.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="glass-panel finances-summary-card finances-summary-card--cost">
          <span className="finances-summary-card__label">Coûts totaux</span>
          <span className="finances-summary-card__value">{formatCurrency(summary.totalCost)}</span>
        </div>

        <div className="glass-panel finances-summary-card finances-summary-card--margin">
          <span className="finances-summary-card__label">Marge nette</span>
          <span
            className={`finances-summary-card__value ${summary.totalMargin >= 0 ? 'finances-summary-card__value--positive' : 'finances-summary-card__value--negative'}`}
          >
            {formatCurrency(summary.totalMargin)}
          </span>
          <span
            className={`finances-summary-card__badge ${summary.totalMarginPercent >= 0 ? 'finances-summary-card__badge--positive' : 'finances-summary-card__badge--negative'}`}
          >
            {summary.totalMarginPercent >= 0 ? (
              <TrendingUp size={10} />
            ) : (
              <TrendingDown size={10} />
            )}
            {summary.totalMarginPercent}%
          </span>
        </div>

        <div className="glass-panel finances-summary-card finances-summary-card--hours">
          <span className="finances-summary-card__label">Heures travaillées</span>
          <span className="finances-summary-card__value">{summary.totalHours}h</span>
        </div>

        <div className="glass-panel finances-summary-card finances-summary-card--budget">
          <span className="finances-summary-card__label">Budget total</span>
          <span className="finances-summary-card__value">
            {formatCurrency(summary.totalBudget)}
          </span>
        </div>
      </div>

      {/* Project Finance Table */}
      <section className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 'var(--space-xl)', borderBottom: '1px solid var(--glass-border)' }}>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>Détail par projet</h3>
        </div>

        <div className="finances-table-container">
          <table className="finances-table">
            <thead>
              <tr>
                <th>Projet</th>
                <th>Type</th>
                <th>Budget</th>
                <th>Coût</th>
                <th>CA</th>
                <th>Marge</th>
                <th>Heures</th>
                <th>Consommation</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {summary.projects.map((proj) => (
                <tr key={proj.projectId}>
                  <td>
                    <span className="finances-table__project-name">{proj.projectName}</span>
                  </td>
                  <td>
                    <span className="finances-table__billing-badge">
                      {proj.billingType === 'FIXED_PRICE' ? 'Forfait' : 'Régie'}
                    </span>
                  </td>
                  <td>{proj.budgetCents ? formatCurrency(proj.budgetCents) : '—'}</td>
                  <td>{formatCurrency(proj.actualCostCents)}</td>
                  <td>{formatCurrency(proj.actualRevenueCents)}</td>
                  <td>
                    <span
                      style={{
                        color:
                          proj.marginCents >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                        fontWeight: 600,
                      }}
                    >
                      {proj.marginPercent}%
                    </span>
                  </td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={12} color="var(--text-muted)" />
                      {proj.totalHours}h
                    </span>
                  </td>
                  <td>
                    {proj.budgetCents ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="finances-burn-bar">
                          <div
                            className={`finances-burn-bar__fill ${getBurnClass(proj.burnPercent)}`}
                            style={{ width: `${Math.min(proj.burnPercent, 100)}%` }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 'var(--font-2xs)',
                            color: 'var(--text-muted)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {proj.burnPercent}%
                        </span>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {proj.hasBudgetAlert && (
                      <span className="finances-alert-badge">
                        <AlertTriangle size={10} />
                        Dépassé
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
