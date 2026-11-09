import { fireEvent, render, screen } from '@testing-library/react';
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
const purposeRef = vi.hoisted(() => ({ value: 'repos' as 'link' | 'repos' }));
vi.mock('./github-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./github-oauth')>()),
  fetchGitHubPurpose: async () => purposeRef.value,
}));
vi.mock('./components/GovernanceView', () => ({
  GovernanceView: ({ resumeRepoProjectId }: { resumeRepoProjectId?: string | null }) => (
    <p data-testid="governance">gouvernance:{resumeRepoProjectId ?? 'aucun'}</p>
  ),
}));
vi.mock('./components/DashboardContent', () => ({
  DashboardContent: () => <p>Tableau de bord</p>,
}));
vi.mock('./components/AiCommandBar', () => ({ AiCommandBar: () => null }));
vi.mock('./components/NotificationInbox', () => ({ NotificationInbox: () => null }));
vi.mock('./components/OnboardingModal', () => ({ OnboardingModal: () => null }));

import App from './App';
import { PENDING_REPO_KEY, PENDING_REPO_TTL_MS, savePendingRepo } from './pending-repo';

global.fetch = vi.fn();

const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const identities = {
  firebase: { linked: false, email: null },
  github: { linked: true, username: 'ada-gh' },
  hasPassword: true,
  mfaEnabled: false,
  canUnlink: { firebase: false, github: true },
};

/** Retour de GitHub (finalité `repos`) : retour sur le projet en attente, sélecteur à rouvrir (P9-R). */
describe('App : retour GitHub « Connecter un dépôt » (P9-R)', () => {
  const originalLocation = window.location.href;

  beforeEach(() => {
    purposeRef.value = 'repos';
    sessionStorage.clear();
    localStorage.setItem('planner_onboarding_completed_u1', 'true');
    vi.mocked(global.fetch).mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      const body =
        path === '/auth/github/link'
          ? { githubUsername: 'ada-gh', repoAccess: true }
          : path === '/auth/sessions'
            ? []
            : identities;
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    window.history.replaceState({}, '', '/?code=gh-code&state=gh-state');
  });
  afterEach(() => window.history.replaceState({}, '', originalLocation));

  const confirm = async () => {
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Mot de passe Planner-Pro'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la liaison GitHub' }));
  };

  it('projet en attente valide : retour sur la gouvernance avec ce projet, entrée consommée', async () => {
    savePendingRepo(ID);
    await confirm();
    expect(await screen.findByTestId('governance')).toHaveTextContent(`gouvernance:${ID}`);
    expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
  });

  it('entrée expirée : ignorée, retour sur « Sécurité du compte »', async () => {
    savePendingRepo(ID, Date.now() - PENDING_REPO_TTL_MS - 1000);
    await confirm();
    expect(await screen.findByText('Identités liées')).toBeInTheDocument();
    expect(screen.queryByTestId('governance')).toBeNull();
  });

  it('identifiant altéré dans le stockage : ignoré, retour sur « Sécurité du compte »', async () => {
    sessionStorage.setItem(
      PENDING_REPO_KEY,
      JSON.stringify({ projectId: '../../auth/sessions', expiresAt: Date.now() + 60_000 }),
    );
    await confirm();
    expect(await screen.findByText('Identités liées')).toBeInTheDocument();
    expect(screen.queryByTestId('governance')).toBeNull();
    expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
  });

  it('finalité link : un projet en attente ne détourne pas vers la gouvernance', async () => {
    purposeRef.value = 'link';
    savePendingRepo(ID);
    await confirm();
    expect(await screen.findByText('Identités liées')).toBeInTheDocument();
    expect(screen.queryByTestId('governance')).toBeNull();
  });

  it('annuler la confirmation supprime l’entrée en attente', async () => {
    savePendingRepo(ID);
    render(<App />);
    await screen.findByLabelText('Mot de passe Planner-Pro');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
  });
});
