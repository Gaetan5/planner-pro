import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

vi.mock('./context/AppContext', () => ({
  AppProvider: ({ children }: { children: unknown }) => children,
  useApp: () => {
    const [activeTab, setActiveTab] = useState('dashboard');
    return {
      user: { id: 'u1', email: 'ada@corp.com', name: 'Ada', platformRole: 'USER' },
      login: vi.fn(),
      ssoLogin: vi.fn(),
      logout: vi.fn(),
      activeTab,
      setActiveTab,
      currentUserRole: 'OWNER',
      theme: 'dark',
    };
  },
}));
vi.mock('./github-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./github-oauth')>()),
  fetchGitHubPurpose: async () => 'link',
}));
vi.mock('./components/DashboardContent', () => ({
  DashboardContent: () => <p>Tableau de bord</p>,
}));
vi.mock('./components/AiCommandBar', () => ({ AiCommandBar: () => null }));
vi.mock('./components/NotificationInbox', () => ({ NotificationInbox: () => null }));
vi.mock('./components/OnboardingModal', () => ({ OnboardingModal: () => null }));

import App from './App';

global.fetch = vi.fn();

const identities = {
  firebase: { linked: false, email: null },
  github: { linked: true, username: 'ada-gh' },
  hasPassword: true,
  mfaEnabled: false,
  canUnlink: { firebase: false, github: true },
};

describe('App : notice de liaison (P9-L-c)', () => {
  const originalLocation = window.location.href;

  beforeEach(() => {
    localStorage.setItem('planner_onboarding_completed_u1', 'true');
    vi.mocked(global.fetch).mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      const body =
        path === '/auth/github/link' ? { githubUsername: 'ada-gh', repoAccess: false } : identities;
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    window.history.replaceState({}, '', '/?code=gh-code&state=gh-state');
  });

  afterEach(() => window.history.replaceState({}, '', originalLocation));

  it('affichée une seule fois : disparue après un changement d’onglet puis le retour', async () => {
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Mot de passe Planner-Pro'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la liaison GitHub' }));

    // Retour sur « Sécurité du compte » avec le message de la liaison
    expect(await screen.findByText(/Compte GitHub ada-gh associé/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Dashboard' })[0]);
    await screen.findByText('Tableau de bord');
    fireEvent.click(screen.getByRole('button', { name: 'Sécurité du compte' }));

    await screen.findByText('Identités liées');
    await waitFor(() =>
      expect(screen.queryByText(/Compte GitHub ada-gh associé/)).not.toBeInTheDocument(),
    );
  });
});
