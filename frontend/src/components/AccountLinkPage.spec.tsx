import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountLinkPage } from './AccountLinkPage';
import { readAccountLink } from '../account-api';

global.fetch = vi.fn();

const answer = (ok: boolean, message: string) =>
  vi.mocked(global.fetch).mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: async () => ({ message }),
  } as Response);

describe('AccountLinkPage (P6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ne consomme pas le jeton à l'ouverture : il faut un clic", () => {
    answer(true, 'ok');
    render(<AccountLinkPage link={{ kind: 'verify', token: 'tok' }} onDone={vi.fn()} />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("confirme l'adresse avec le jeton dans le corps d'un POST", async () => {
    answer(true, 'Adresse e-mail confirmée.');
    render(<AccountLinkPage link={{ kind: 'verify', token: 'tok' }} onDone={vi.fn()} />);
    fireEvent.click(screen.getByText('Confirmer mon adresse'));
    expect(await screen.findByText('Adresse e-mail confirmée.')).toBeInTheDocument();
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain('/auth/email/verify');
    expect(String(url)).not.toContain('tok');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ token: 'tok' });
  });

  it('affiche un lien invalide ou expiré', async () => {
    answer(false, 'Lien invalide ou expiré.');
    render(<AccountLinkPage link={{ kind: 'verify', token: 'tok' }} onDone={vi.fn()} />);
    fireEvent.click(screen.getByText('Confirmer mon adresse'));
    expect(await screen.findByText('Lien invalide ou expiré.')).toBeInTheDocument();
  });

  it('réinitialisation : refuse un mot de passe trop court ou non confirmé sans appel réseau', async () => {
    answer(true, 'ok');
    render(<AccountLinkPage link={{ kind: 'reset', token: 'tok' }} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'court' } });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), {
      target: { value: 'court' },
    });
    fireEvent.click(screen.getByText('Changer le mot de passe'));
    expect(await screen.findByText(/au moins 10 caractères/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), {
      target: { value: 'NouveauMdp!2027' },
    });
    fireEvent.click(screen.getByText('Changer le mot de passe'));
    expect(await screen.findByText(/ne correspondent pas/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('réinitialisation : envoie jeton et mot de passe', async () => {
    answer(true, 'Mot de passe modifié.');
    render(<AccountLinkPage link={{ kind: 'reset', token: 'tok' }} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), {
      target: { value: 'NouveauMdp!2027' },
    });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), {
      target: { value: 'NouveauMdp!2027' },
    });
    fireEvent.click(screen.getByText('Changer le mot de passe'));
    await waitFor(() => expect(screen.getByText('Mot de passe modifié.')).toBeInTheDocument());
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain('/auth/password/reset');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      token: 'tok',
      password: 'NouveauMdp!2027',
    });
  });
});

describe('readAccountLink', () => {
  it("lit le jeton puis le retire de l'URL", () => {
    window.history.replaceState({}, '', '/?reset=abc&x=1');
    expect(readAccountLink()).toEqual({ kind: 'reset', token: 'abc' });
    expect(window.location.search).toBe('?x=1');
    expect(readAccountLink()).toBeNull();
  });
});
