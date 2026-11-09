import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../context/AppContext';
import { IntegrationsPanel } from './IntegrationsPanel';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

const refreshData = vi.fn();
const mockIntegrations = (integrations: unknown[]) =>
  vi.mocked(useApp).mockReturnValue({
    refreshData,
    listIntegrations: vi.fn().mockResolvedValue(integrations),
    createIntegration: vi.fn(),
    toggleIntegration: vi.fn(),
    deleteIntegration: vi.fn(),
    exportToCalendar: vi.fn(),
    getCalendarConflicts: vi.fn().mockResolvedValue([]),
    user: { id: 'u-1', token: 't' },
  } as unknown as ReturnType<typeof useApp>);

describe('IntegrationsPanel : état réel des intégrations (P1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche « Non configuré » pour une intégration sans source réelle', async () => {
    mockIntegrations([
      {
        id: 'i-1',
        type: 'GOOGLE_CALENDAR',
        name: 'Agenda équipe',
        active: true,
        status: 'NOT_CONFIGURED',
      },
    ]);
    render(<IntegrationsPanel workspaceId="ws-1" />);

    expect(await screen.findByText('Agenda équipe')).toBeInTheDocument();
    expect(screen.getByText('Non configuré')).toBeInTheDocument();
    expect(screen.queryByText('Connecté')).not.toBeInTheDocument();
    expect(screen.queryByText('Actif')).not.toBeInTheDocument();
    expect(screen.queryByText('Démonstration')).not.toBeInTheDocument();
  });

  it('affiche « Connecté » seulement quand le serveur le confirme', async () => {
    mockIntegrations([
      { id: 'i-2', type: 'SLACK', name: 'Canal projet', active: true, status: 'CONNECTED' },
    ]);
    render(<IntegrationsPanel workspaceId="ws-1" />);

    expect(await screen.findByText('Connecté')).toBeInTheDocument();
  });

  it('ne suggère plus le simulateur de calendrier dans le formulaire', async () => {
    mockIntegrations([]);
    const { container } = render(<IntegrationsPanel workspaceId="ws-1" />);
    const select = await screen.findByDisplayValue('Slack (Webhook)');
    fireEvent.change(select, { target: { value: 'GOOGLE_CALENDAR' } });
    expect(await screen.findByText(/URL de flux/)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/mock-calendar|Simulateur/);
  });

  // P9-R : section « Dépôt GitHub » du projet
  it('« Connecter un dépôt » : présent avec le droit de gestion, absent sans, absent sans projet', async () => {
    const project = { id: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b', githubRepo: 'acme/api' };
    mockIntegrations([]);
    const { rerender } = render(
      <IntegrationsPanel workspaceId="ws-1" project={project} canManageProject />,
    );
    expect(await screen.findByRole('button', { name: 'Connecter un dépôt' })).toBeInTheDocument();
    expect(screen.getByText(/Dépôt lié : acme\/api/)).toBeInTheDocument();

    rerender(<IntegrationsPanel workspaceId="ws-1" project={project} canManageProject={false} />);
    expect(screen.queryByRole('button', { name: 'Connecter un dépôt' })).toBeNull();

    rerender(<IntegrationsPanel workspaceId="ws-1" />);
    expect(screen.queryByText('Dépôt GitHub')).toBeNull();
  });

  it('après la liaison d’un dépôt, les données sont relues (refreshData appelé une fois)', async () => {
    const project = { id: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b', githubRepo: null };
    mockIntegrations([]);
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { id: 1, name: 'web', fullName: 'acme/web', description: null, private: false },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: project.id, githubRepo: 'acme/web' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    render(<IntegrationsPanel workspaceId="ws-1" project={project} canManageProject />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter un dépôt' }));
    refreshData.mockClear();
    fireEvent.click(await screen.findByRole('button', { name: 'Lier acme/web' }));
    await screen.findByText(/Dépôt lié : acme\/web/);
    expect(refreshData).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
