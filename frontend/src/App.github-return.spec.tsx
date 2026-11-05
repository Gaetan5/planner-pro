import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  purpose: 'link' as 'login' | 'link' | 'repos',
}));

vi.mock('./context/AppContext', () => ({
  AppProvider: ({ children }: { children: unknown }) => children,
  useApp: () => ({
    user: { id: 'u1', email: 'ada@corp.com', name: 'Ada' },
    login: mocks.login,
    ssoLogin: vi.fn(),
    activeTab: 'security',
    setActiveTab: vi.fn(),
  }),
}));
vi.mock('./github-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./github-oauth')>()),
  fetchGitHubPurpose: async () => mocks.purpose,
}));

import App from './App';

global.fetch = vi.fn();

/**
 * Retour de GitHub (S9-b, S31) : avec la finalité `link` ou `repos`, l'application affiche
 * l'écran de confirmation et n'appelle PAS `/auth/github/link` sans preuve de réauthentification.
 */
describe('App : retour GitHub selon la finalité', () => {
  const originalLocation = window.location.href;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        firebase: { linked: false, email: null },
        github: { linked: false, username: null },
        hasPassword: true,
        mfaEnabled: false,
      }),
    } as Response);
    window.history.replaceState({}, '', '/?code=gh-code&state=gh-state');
  });

  afterEach(() => window.history.replaceState({}, '', originalLocation));

  const paths = () =>
    vi.mocked(global.fetch).mock.calls.map(([url]) => new URL(String(url)).pathname);

  it.each(['link', 'repos'] as const)(
    'finalité %s : écran de confirmation, aucun appel de liaison avant la preuve',
    async (purpose) => {
      mocks.purpose = purpose;
      render(<App />);
      await screen.findByLabelText('Mot de passe Planner-Pro');
      expect(screen.getByText('ada@corp.com')).toBeInTheDocument();
      expect(paths()).not.toContain('/auth/github/link');
      expect(mocks.login).not.toHaveBeenCalled();
      // Le code et le state ne restent pas dans l'URL
      expect(window.location.search).toBe('');
    },
  );

  it('finalité login : connexion, pas d’écran de liaison', async () => {
    mocks.purpose = 'login';
    mocks.login.mockResolvedValue(undefined);
    render(<App />);
    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith('gh-code', 'gh-state'));
    expect(screen.queryByLabelText('Mot de passe Planner-Pro')).not.toBeInTheDocument();
    expect(paths()).not.toContain('/auth/github/link');
  });
});
