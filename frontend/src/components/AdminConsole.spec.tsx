import { render, screen, waitFor } from '@testing-library/react';
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
      user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com', token: 'admin-token' },
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
          dependencies: { database: 'healthy', redis: 'healthy' },
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
      expect(screen.getByText('platform.admin.bootstrap')).toBeInTheDocument();
    });
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getAllByText('Opérationnel')).toHaveLength(2);
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/overview'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer admin-token' },
      }),
    );
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
});
