import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { KanbanBoard } from './KanbanBoard';
import { useApp } from '../context/AppContext';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

describe('KanbanBoard', () => {
  const updateTask = vi.fn();
  const task = {
    id: 'task-1',
    title: 'Planifier la livraison',
    status: 'TODO',
    priority: 'HIGH',
    projectId: 'project-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      projects: [{ id: 'project-1', name: 'Projet', workspaceId: 'workspace-1', tasks: [task] }],
      workspaceMembers: [],
      workspaces: [{ id: 'workspace-1', name: 'Workspace', ownerId: 'user-1' }],
      createTask: vi.fn(),
      updateTask,
      deleteTask: vi.fn(),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      startTimer: vi.fn(),
      activeTimer: null,
      stopTimer: vi.fn(),
      addTaskDependency: vi.fn(),
      isReadOnly: false,
      isReadOnlyForWorkspace: vi.fn(() => false),
    } as unknown as ReturnType<typeof useApp>);
  });

  it('doit rendre le titre du projet', () => {
    render(<KanbanBoard />);
    expect(screen.getByText('Projets')).toBeInTheDocument();
  });

  it('doit ouvrir le formulaire de création de tâche lors du clic sur le bouton "Ajouter"', () => {
    render(<KanbanBoard />);

    const addButton = screen.getByText(/Ajouter une tâche/i);
    fireEvent.click(addButton);

    expect(screen.getByText('Nouvelle Tâche')).toBeInTheDocument();
  });

  it('does not change task status when the card is clicked', () => {
    render(<KanbanBoard />);

    fireEvent.click(screen.getByText(task.title));

    expect(updateTask).not.toHaveBeenCalled();
  });
});
