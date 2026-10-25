import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioDashboard } from './PortfolioDashboard';
import { useApp } from '../context/AppContext';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

describe('PortfolioDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not score an empty project or claim it is complete', () => {
    vi.mocked(useApp).mockReturnValue({
      projects: [{ id: 'p1', name: 'Projet vide', tasks: [] }],
    } as unknown as ReturnType<typeof useApp>);

    render(<PortfolioDashboard />);

    expect(screen.getByText(/Non évalué/)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Burn Rate/i)).not.toBeInTheDocument();
  });

  it('does not count a task due today as overdue', () => {
    const today = new Date();
    const dueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    vi.mocked(useApp).mockReturnValue({
      projects: [
        {
          id: 'p1',
          name: 'Projet actif',
          tasks: [
            {
              id: 't1',
              title: 'Échéance aujourd’hui',
              status: 'TODO',
              priority: 'HIGH',
              dueDate,
            },
          ],
        },
      ],
    } as unknown as ReturnType<typeof useApp>);

    render(<PortfolioDashboard />);

    const overdueLabel = screen
      .getAllByText('Tâches en Retard')
      .find((element) => element.classList.contains('health-metric-label'));
    expect(overdueLabel).toBeDefined();
    expect(overdueLabel?.parentElement).toHaveTextContent('0');
  });
});
