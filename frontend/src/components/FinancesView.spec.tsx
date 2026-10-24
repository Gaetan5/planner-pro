import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => undefined));
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

  it('permet de sélectionner un autre workspace financier', async () => {
    vi.mocked(useApp).mockReturnValue({
      user: { token: 'fake-token' } as unknown as {
        token: string;
        id: string;
        email: string;
        name: string;
      },
      workspaces: [
        { id: 'w1', name: 'W1', ownerId: 'u1' },
        { id: 'w2', name: 'W2', ownerId: 'u1' },
      ],
    } as unknown as ReturnType<typeof useApp>);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        workspaceId: 'w1',
        totalBudget: 0,
        totalCost: 0,
        totalRevenue: 0,
        totalMargin: 0,
        totalMarginPercent: 0,
        totalHours: 0,
        projects: [],
      }),
    } as unknown as Response);

    render(<FinancesView />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/workspaces/w1/finances'),
        expect.any(Object),
      );
    });

    fireEvent.change(screen.getByLabelText('Workspace financier'), { target: { value: 'w2' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/workspaces/w2/finances'),
        expect.any(Object),
      );
    });
  });

  it("quitte l'état de chargement lorsqu'aucun workspace n'est disponible", async () => {
    vi.mocked(useApp).mockReturnValue({
      user: { token: 'fake-token' } as unknown as {
        token: string;
        id: string;
        email: string;
        name: string;
      },
      workspaces: [],
    } as unknown as ReturnType<typeof useApp>);

    render(<FinancesView />);

    await waitFor(() => {
      expect(screen.queryByText(/Chargement des données financières/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Aucune donnée financière disponible/i)).toBeInTheDocument();
  });
});
