import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../context/AppContext';
import { IntegrationsPanel } from './IntegrationsPanel';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

const mockIntegrations = (integrations: unknown[]) =>
  vi.mocked(useApp).mockReturnValue({
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
});
