import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  user: null as null | { id: string; email: string; name: string },
  login: vi.fn(),
  checkInvitation: vi.fn(),
}));

vi.mock('./context/AppContext', () => ({
  AppProvider: ({ children }: { children: unknown }) => children,
  useApp: () => ({
    user: mocks.user,
    login: mocks.login,
    ssoLogin: vi.fn(),
    logout: mocks.logout,
    activeTab: 'dashboard',
    setActiveTab: vi.fn(),
    checkInvitation: mocks.checkInvitation,
    acceptInvitation: vi.fn(),
  }),
}));
vi.mock('./github-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./github-oauth')>()),
  fetchGitHubPurpose: async () => 'login',
}));
vi.mock('./components/DashboardContent', () => ({
  DashboardContent: () => <div>Tableau de bord</div>,
}));
vi.mock('./components/Login', () => ({
  Login: (p: { initialMfaTicket?: string; invitation?: unknown }) => (
    <div>
      Écran Login {p.initialMfaTicket ?? ''} {p.invitation ? 'invitation' : ''}
    </div>
  ),
}));

import App from './App';
import { PENDING_INVITE_KEY, savePendingInvite } from './invitation-store';

const INFO = {
  workspaceName: 'Atelier',
  invitedByName: 'Grace',
  role: 'MEMBER',
  email: 'a***@c.com',
};

describe('App : retour de connexion pendant une invitation (P13-a)', () => {
  const originalHref = window.location.href;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.user = null;
    mocks.checkInvitation.mockResolvedValue(INFO);
    window.history.replaceState({}, '', '/?code=gh-code&state=gh-state');
  });
  afterEach(() => window.history.replaceState({}, '', originalHref));

  it('GitHub : sans jeton dans l’URL, l’entrée valide restitue l’écran d’invitation une fois connecté', async () => {
    savePendingInvite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    mocks.login.mockImplementation(async () => {
      mocks.user = { id: 'u1', email: 'ada@corp.com', name: 'Ada' };
    });
    render(<App />);
    expect(await screen.findByText(/Accepter l'Invitation/)).toBeInTheDocument();
    expect(mocks.checkInvitation).toHaveBeenCalledWith(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(window.location.search).toBe('');
  });

  it('défi MFA : Login reçoit le ticket, puis l’invitation s’affiche une fois la session complète', async () => {
    savePendingInvite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    mocks.login.mockResolvedValue({ mfaRequired: true, mfaTicket: 'ticket-9' });
    render(<App />);
    expect(await screen.findByText(/Écran Login ticket-9 invitation/)).toBeInTheDocument();
  });

  it('entrée expirée : ignorée et supprimée, pas d’écran d’invitation', async () => {
    sessionStorage.setItem(
      PENDING_INVITE_KEY,
      JSON.stringify({ token: 'vieux', expiresAt: Date.now() - 1000 }),
    );
    window.history.replaceState({}, '', '/');
    render(<App />);
    expect(await screen.findByText(/Écran Login/)).toBeInTheDocument();
    expect(mocks.checkInvitation).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('?token= : retiré de l’URL au montage et conservé en sessionStorage', async () => {
    window.history.replaceState(
      {},
      '',
      '/?token=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    render(<App />);
    await screen.findByText('Se connecter ou créer un compte');
    expect(window.location.search).toBe('');
    expect(JSON.parse(sessionStorage.getItem(PENDING_INVITE_KEY)!).token).toBe(
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(mocks.checkInvitation).toHaveBeenCalledWith(
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
  });

  it('« Se déconnecter » de l’en-tête supprime l’invitation en attente (FM11)', async () => {
    mocks.user = { id: 'u1', email: 'ada@corp.com', name: 'Ada' };
    window.history.replaceState({}, '', '/');
    render(<App />);
    const logoutButton = await screen.findByTitle('Se déconnecter');
    // Invitation conservée par ailleurs (ex. « Changer de compte »), l'écran d'invitation n'est pas monté
    savePendingInvite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    fireEvent.click(logoutButton);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });
});
