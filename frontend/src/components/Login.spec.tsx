import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../context/AppContext';
import { Login } from './Login';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

vi.mock('../firebase-config', () => ({
  isFirebaseAuthConfigured: false,
}));

global.fetch = vi.fn();

const mockFeatures = (flags: { sso: boolean; scim: boolean }) =>
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => flags,
  } as Response);

describe('Login : interrupteur SSO (P3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      mockLogin: vi.fn(),
      classicLogin: vi.fn(),
      classicRegister: vi.fn(),
      firebaseLogin: vi.fn(),
      verifyMfa: vi.fn(),
      discoverSso: vi.fn(),
    } as unknown as ReturnType<typeof useApp>);
  });

  it("masque l'onglet SSO Entreprise quand la fonctionnalité est désactivée côté serveur", async () => {
    mockFeatures({ sso: false, scim: false });
    render(<Login />);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/features')),
    );
    expect(screen.queryByText('SSO Entreprise')).not.toBeInTheDocument();
  });

  it("masque l'onglet SSO si le serveur est injoignable", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('réseau'));
    render(<Login />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText('SSO Entreprise')).not.toBeInTheDocument();
  });

  it("affiche l'onglet SSO Entreprise quand la fonctionnalité est activée", async () => {
    mockFeatures({ sso: true, scim: false });
    render(<Login />);
    expect(await screen.findByText('SSO Entreprise')).toBeInTheDocument();
  });
});

describe('Login : second facteur après un retour OAuth (S8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApp).mockReturnValue({
      mockLogin: vi.fn(),
      classicLogin: vi.fn(),
      classicRegister: vi.fn(),
      firebaseLogin: vi.fn(),
      verifyMfa: vi.fn(),
      discoverSso: vi.fn(),
    } as unknown as ReturnType<typeof useApp>);
    mockFeatures({ sso: false, scim: false });
  });

  it('affiche directement le formulaire de code quand un ticket MFA est fourni', async () => {
    render(<Login initialMfaTicket="ticket-oauth" />);
    expect(await screen.findByText('Validation en deux étapes')).toBeInTheDocument();
    expect(screen.queryByText('Se connecter')).not.toBeInTheDocument();
  });

  it('permet de valider le challenge avec un code de récupération', async () => {
    const verifyMfa = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApp).mockReturnValue({
      mockLogin: vi.fn(),
      classicLogin: vi.fn(),
      classicRegister: vi.fn(),
      firebaseLogin: vi.fn(),
      verifyMfa,
      discoverSso: vi.fn(),
    } as unknown as ReturnType<typeof useApp>);
    render(<Login initialMfaTicket="ticket-oauth" />);

    fireEvent.click(await screen.findByText('Utiliser un code de récupération'));
    fireEvent.change(screen.getByLabelText('Code de récupération'), {
      target: { value: 'abcde-fghjk' },
    });
    fireEvent.click(screen.getByText('Valider la connexion'));

    await waitFor(() =>
      expect(verifyMfa).toHaveBeenCalledWith('ticket-oauth', { recoveryCode: 'ABCDE-FGHJK' }),
    );
  });
});

describe('Login : parcours de compte par e-mail (P6)', () => {
  const setup = (overrides: Record<string, unknown> = {}) => {
    vi.mocked(useApp).mockReturnValue({
      mockLogin: vi.fn(),
      classicLogin: vi.fn(),
      classicRegister: vi.fn(),
      firebaseLogin: vi.fn(),
      verifyMfa: vi.fn(),
      discoverSso: vi.fn(),
      ...overrides,
    } as unknown as ReturnType<typeof useApp>);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatures({ sso: false, scim: false });
  });

  it("l'inscription affiche le message générique et ne connecte pas", async () => {
    const classicRegister = vi.fn().mockResolvedValue('Un e-mail de confirmation vient de partir.');
    setup({ classicRegister });
    const { container } = render(<Login />);
    fireEvent.click(screen.getAllByText("S'inscrire")[0]);
    const inputs = container.querySelectorAll('form input');
    fireEvent.change(inputs[0], { target: { value: 'Ada' } });
    fireEvent.change(inputs[1], { target: { value: 'ada@corp.com' } });
    fireEvent.change(inputs[2], { target: { value: 'MotDePasse!2026' } });
    fireEvent.submit(container.querySelector('form')!);

    expect(
      await screen.findByText('Un e-mail de confirmation vient de partir.'),
    ).toBeInTheDocument();
    expect(classicRegister).toHaveBeenCalledWith('ada@corp.com', 'MotDePasse!2026', 'Ada');
  });

  it('refuse côté client un mot de passe de moins de 10 caractères', async () => {
    const classicRegister = vi.fn();
    setup({ classicRegister });
    const { container } = render(<Login />);
    fireEvent.click(screen.getAllByText("S'inscrire")[0]);
    const inputs = container.querySelectorAll('form input');
    fireEvent.change(inputs[0], { target: { value: 'Ada' } });
    fireEvent.change(inputs[1], { target: { value: 'ada@corp.com' } });
    fireEvent.change(inputs[2], { target: { value: 'Court1!' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(await screen.findByText(/au moins 10 caractères/)).toBeInTheDocument();
    expect(classicRegister).not.toHaveBeenCalled();
  });

  it('« Mot de passe oublié » appelle /auth/password/forgot et affiche la réponse générique', async () => {
    setup();
    vi.mocked(global.fetch).mockImplementation(async (url: RequestInfo | URL) =>
      String(url).includes('/auth/password/forgot')
        ? ({
            ok: true,
            status: 202,
            json: async () => ({ message: 'Si un compte existe…' }),
          } as Response)
        : ({ ok: true, status: 200, json: async () => ({ sso: false }) } as Response),
    );
    render(<Login />);
    fireEvent.click(screen.getByText('Mot de passe oublié ?'));
    fireEvent.change(screen.getByLabelText('Adresse E-mail'), {
      target: { value: 'ada@corp.com' },
    });
    fireEvent.click(screen.getByText('Envoyer le lien de réinitialisation'));
    expect(await screen.findByText('Si un compte existe…')).toBeInTheDocument();
    const call = vi
      .mocked(global.fetch)
      .mock.calls.find(([u]) => String(u).includes('/auth/password/forgot'))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ email: 'ada@corp.com' });
  });

  it("propose de renvoyer le lien quand la connexion est refusée faute d'adresse vérifiée", async () => {
    const classicLogin = vi
      .fn()
      .mockRejectedValue(new Error('Adresse e-mail non vérifiée. Consultez le lien.'));
    setup({ classicLogin });
    const { container } = render(<Login />);
    const inputs = container.querySelectorAll('form input');
    fireEvent.change(inputs[0], { target: { value: 'ada@corp.com' } });
    fireEvent.change(inputs[1], { target: { value: 'MotDePasse!2026' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(await screen.findByText("Renvoyer l'e-mail de confirmation")).toBeInTheDocument();
  });
});
