import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../context/AppContext';
import { AdminConsole } from './AdminConsole';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

global.fetch = vi.fn();

describe('AdminConsole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
    } as unknown as ReturnType<typeof useApp>);
  });

  it('displays aggregate metrics, dependency status and audited activity', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          generatedAt: '2026-11-07T12:00:00.000Z',
          totals: { users: 8, workspaces: 3, projects: 5, tasks: 24, notifications: 16 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'healthy',
          checkedAt: '2026-11-07T12:00:00.000Z',
          dependencies: {
            database: 'healthy',
            redis: 'healthy',
            firestoreSync: {
              state: 'disabled',
              pendingEvents: null,
              retryingEvents: null,
              oldestPendingAt: null,
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          total: 1,
          entries: [
            {
              id: 'audit-1',
              action: 'platform.admin.bootstrap',
              targetType: 'User',
              targetId: 'admin-1',
              createdAt: '2026-11-07T12:00:00.000Z',
              actor: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
            },
          ],
        }),
      } as Response);

    render(<AdminConsole />);

    await waitFor(() => {
      expect(screen.getByText('8')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Opérationnel')).toHaveLength(2);
    expect(screen.getByText('Miroir Firestore')).toBeInTheDocument();
    expect(screen.getByText('Désactivé')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Journal d'Audit/i }));

    await waitFor(() => {
      expect(screen.getByText('platform.admin.bootstrap')).toBeInTheDocument();
    });
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3);
    // S7 : l'authentification passe par les cookies de session, plus par un en-tête Authorization
    const overviewCall = vi
      .mocked(global.fetch)
      .mock.calls.find(([url]) => String(url).includes('/admin/overview'));
    expect(overviewCall).toBeDefined();
    expect(JSON.stringify(overviewCall![1])).not.toMatch(/Authorization|Bearer/i);
  });

  it('explains when an authenticated account is not a platform administrator', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 403,
    } as Response);

    render(<AdminConsole />);

    expect(
      await screen.findByText("Votre compte n'a pas accès à l'administration de la plateforme."),
    ).toBeInTheDocument();
  });

  // S18, étape 0 : bouton d'impersonation masqué tant que le drapeau serveur est désactivé
  describe('bouton Impersonate (FEATURE_IMPERSONATION_ENABLED)', () => {
    const routeFetch = (impersonation: boolean) =>
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const url = String(input);
        const json = (body: unknown) =>
          ({ ok: true, status: 200, json: async () => body }) as Response;
        if (url.includes('/features')) return json({ sso: false, scim: false, impersonation });
        if (url.includes('/admin/users'))
          return json({
            total: 1,
            entries: [
              {
                id: 'user-2',
                email: 'cible@example.com',
                name: 'Cible',
                platformRole: null,
                createdAt: '2026-11-07T12:00:00.000Z',
                counts: { workspaces: 1, memberships: 1, projects: 0, tasks: 0 },
              },
            ],
          });
        if (url.includes('/admin/overview'))
          return json({
            generatedAt: '2026-11-07T12:00:00.000Z',
            totals: { users: 1, workspaces: 1, projects: 0, tasks: 0, notifications: 0 },
          });
        return json({
          status: 'healthy',
          checkedAt: '2026-11-07T12:00:00.000Z',
          dependencies: {
            database: 'healthy',
            redis: 'healthy',
            firestoreSync: {
              state: 'disabled',
              pendingEvents: null,
              retryingEvents: null,
              oldestPendingAt: null,
            },
          },
        });
      });

    const openUsersTab = async () => {
      render(<AdminConsole />);
      fireEvent.click(await screen.findByRole('button', { name: /Utilisateurs/i }));
      await screen.findByText('cible@example.com');
    };

    it('masque le bouton quand la fonctionnalité est désactivée', async () => {
      routeFetch(false);
      await openUsersTab();
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/features')),
      );
      expect(screen.queryByRole('button', { name: /Impersonate/i })).not.toBeInTheDocument();
    });

    it('affiche le bouton quand la fonctionnalité est activée', async () => {
      routeFetch(true);
      await openUsersTab();
      expect(await screen.findByRole('button', { name: /Impersonate/i })).toBeInTheDocument();
    });
  });
});
