import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GanttView } from './GanttView';
import { AppProvider, useApp } from '../context/AppContext';

// Mock du hook useApp
vi.mock('../context/AppContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/AppContext')>();
  return {
    ...actual,
    useApp: vi.fn(),
  };
});

describe('GanttView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      workspaces: [{ id: 'w1', name: 'WS1', ownerId: 'u1' }],
      projects: [
        {
          id: 'p1',
          name: 'Projet Gantt',
          workspaceId: 'w1',
          tasks: [],
        },
      ],
      updateTask: vi.fn(),
      addTaskDependency: vi.fn(),
      removeTaskDependency: vi.fn(),
      refreshData: vi.fn(),
      getProjectCriticalPath: vi.fn(),
    } as unknown as ReturnType<typeof useApp>);
  });

  it('doit rendre le titre du diagramme de Gantt', () => {
    render(
      <AppProvider>
        <GanttView />
      </AppProvider>,
    );
    expect(screen.getByText(/Diagramme de Gantt Interactif/i)).toBeInTheDocument();
  });

  it('doit afficher les boutons de zoom', () => {
    render(
      <AppProvider>
        <GanttView />
      </AppProvider>,
    );
    expect(screen.getByText(/Jours/i)).toBeInTheDocument();
    expect(screen.getByText(/Semaines/i)).toBeInTheDocument();
  });
});
