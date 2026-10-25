import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardContent } from './DashboardContent';
import { useApp } from '../context/AppContext';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

vi.mock('./CopilotWidget', () => ({ CopilotWidget: () => null }));
vi.mock('./PortfolioDashboard', () => ({ PortfolioDashboard: () => null }));

describe('DashboardContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sorts open tasks by priority and due date', () => {
    vi.mocked(useApp).mockReturnValue({
      activeTimer: null,
      timeBlocks: [],
      projects: [
        {
          id: 'project-1',
          name: 'Projet',
          tasks: [
            { id: 'low', title: 'Priorité basse', status: 'TODO', priority: 'LOW' },
            {
              id: 'high-later',
              title: 'Priorité haute plus tard',
              status: 'IN_PROGRESS',
              priority: 'HIGH',
              dueDate: '2026-10-30',
            },
            {
              id: 'medium',
              title: 'Priorité moyenne',
              status: 'TODO',
              priority: 'MEDIUM',
              dueDate: '2026-10-24',
            },
            {
              id: 'high-sooner',
              title: 'Priorité haute bientôt',
              status: 'TODO',
              priority: 'HIGH',
              dueDate: '2026-10-25',
            },
          ],
        },
      ],
      setActiveTab: vi.fn(),
      stopTimer: vi.fn(),
    } as unknown as ReturnType<typeof useApp>);

    render(<DashboardContent />);

    const titles = screen
      .getAllByText(/Priorité (haute|moyenne|basse)/)
      .filter((element) => element.classList.contains('urgent-task-title'));
    expect(titles.slice(0, 3).map((element) => element.textContent)).toEqual([
      'Priorité haute bientôt',
      'Priorité haute plus tard',
      'Priorité moyenne',
    ]);
  });

  it('only shows time blocks scheduled for today', () => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10);
    const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 10);
    vi.mocked(useApp).mockReturnValue({
      activeTimer: null,
      timeBlocks: [
        {
          id: 'today',
          startTime: todayStart.toISOString(),
          endTime: new Date(todayStart.getTime() + 30 * 60_000).toISOString(),
          taskId: 'task-today',
          task: { title: 'Bloc du jour', project: { name: 'Projet' } },
        },
        {
          id: 'tomorrow',
          startTime: tomorrowStart.toISOString(),
          endTime: new Date(tomorrowStart.getTime() + 30 * 60_000).toISOString(),
          taskId: 'task-tomorrow',
          task: { title: 'Bloc de demain', project: { name: 'Projet' } },
        },
      ],
      projects: [],
      setActiveTab: vi.fn(),
      stopTimer: vi.fn(),
    } as unknown as ReturnType<typeof useApp>);

    render(<DashboardContent />);

    const scheduleHeading = screen.getByText(/Emploi du Temps du Jour/);
    const scheduleSection = scheduleHeading.closest('section');
    expect(scheduleSection).not.toBeNull();
    expect(within(scheduleSection as HTMLElement).getByText('Bloc du jour')).toBeInTheDocument();
    expect(within(scheduleSection as HTMLElement).queryByText('Bloc de demain')).toBeNull();
  });
});
