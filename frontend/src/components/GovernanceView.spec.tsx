import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GovernanceView } from './GovernanceView';
import { useApp } from '../context/AppContext';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

vi.mock('./IntegrationsPanel', () => ({
  IntegrationsPanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="integrations-workspace">{workspaceId}</div>
  ),
}));

vi.mock('./NumberTicker', () => ({ NumberTicker: () => null }));
vi.mock('./RadialProgressRing', () => ({ RadialProgressRing: () => null }));

describe('GovernanceView', () => {
  const getWorkspaceMembers = vi.fn((workspaceId: string) =>
    Promise.resolve([
      {
        id: `member-${workspaceId}`,
        role: 'OWNER',
        user: { id: `owner-${workspaceId}`, name: `Owner ${workspaceId}`, email: 'owner@test.dev' },
      },
    ]),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceMembers.mockImplementation((workspaceId) =>
      Promise.resolve([
        {
          id: `member-${workspaceId}`,
          role: 'OWNER',
          user: {
            id: `owner-${workspaceId}`,
            name: `Owner ${workspaceId}`,
            email: 'owner@test.dev',
          },
        },
      ]),
    );
  });

  it('keeps projects, members and integrations within the selected workspace', async () => {
    const WorkspaceHarness = () => {
      const [activeWorkspaceId, setActiveWorkspaceId] = useState('workspace-1');
      vi.mocked(useApp).mockReturnValue({
        projects: [
          {
            id: 'project-1',
            workspaceId: 'workspace-1',
            name: 'Projet du workspace 1',
            status: 'ACTIVE',
            tasks: [],
            milestones: [],
            deliverables: [],
            deliveries: [],
          },
          {
            id: 'project-2',
            workspaceId: 'workspace-2',
            name: 'Projet du workspace 2',
            status: 'ACTIVE',
            tasks: [],
            milestones: [],
            deliverables: [],
            deliveries: [],
          },
        ],
        workspaces: [
          { id: 'workspace-1', name: 'Workspace 1', ownerId: 'owner-1' },
          { id: 'workspace-2', name: 'Workspace 2', ownerId: 'owner-2' },
        ],
        activeWorkspaceId,
        setActiveWorkspaceId,
        getWorkspaceMembers,
        createMilestone: vi.fn(),
        completeMilestone: vi.fn(),
        createDeliverable: vi.fn(),
        updateDeliverableStatus: vi.fn(),
        createDelivery: vi.fn(),
        updateDeliveryStatus: vi.fn(),
        toggleDeliveryChecklistItem: vi.fn(),
      } as unknown as ReturnType<typeof useApp>);
      return <GovernanceView />;
    };

    const { container } = render(<WorkspaceHarness />);
    const projectList = container.querySelector<HTMLElement>('.project-selector-list');

    if (!projectList) throw new Error('Project list not rendered.');
    const projects = within(projectList);

    expect(projects.getByText('Projet du workspace 1')).toBeInTheDocument();
    expect(projects.queryByText('Projet du workspace 2')).toBeNull();

    fireEvent.change(screen.getByLabelText('Workspace de gouvernance'), {
      target: { value: 'workspace-2' },
    });
    await waitFor(() => {
      expect(projects.getByText('Projet du workspace 2')).toBeInTheDocument();
      expect(projects.queryByText('Projet du workspace 1')).toBeNull();
      expect(getWorkspaceMembers).toHaveBeenLastCalledWith('workspace-2');
      expect(screen.getByText(/Owner workspace-2/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Intégrations & Sync/));
    expect(screen.getByTestId('integrations-workspace')).toHaveTextContent('workspace-2');
  });
});
