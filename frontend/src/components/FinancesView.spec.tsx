import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinancesView } from './FinancesView';
import { useApp } from '../context/AppContext';

// Mock du hook useApp
vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

global.fetch = vi.fn();

describe('FinancesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      user: { token: 'fake-token' } as unknown as {
        token: string;
        id: string;
        email: string;
        name: string;
      },
      workspaces: [{ id: 'w1', name: 'W1', ownerId: 'u1' }],
    } as unknown as ReturnType<typeof useApp>);
  });

  it('doit afficher le chargement initialement', () => {
    render(<FinancesView />);
    expect(screen.getByText(/Chargement des données financières/i)).toBeInTheDocument();
  });

  it('doit afficher une erreur si l API échoue', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as unknown as Response);

    render(<FinancesView />);

    await waitFor(() => {
      expect(
        screen.getByText(/Erreur lors du chargement des données financières/i),
      ).toBeInTheDocument();
    });
  });
});
