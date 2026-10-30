import { render, screen, waitFor } from '@testing-library/react';
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
