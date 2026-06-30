import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinancesView } from './FinancesView';
import { useApp } from '../context/AppContext';
import React from 'react';

// Mock du hook useApp
vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

global.fetch = vi.fn();

describe('FinancesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApp as any).mockReturnValue({
      user: { token: 'fake-token' },
      workspaces: [{ id: 'w1' }],
    });
  });

  it('doit afficher le chargement initialement', () => {
    render(<FinancesView />);
    expect(screen.getByText(/Chargement des données financières/i)).toBeInTheDocument();
  });

  it('doit afficher une erreur si l API échoue', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(<FinancesView />);

    await waitFor(() => {
      expect(screen.getByText(/Erreur lors du chargement des données financières/i)).toBeInTheDocument();
    });
  });
});
