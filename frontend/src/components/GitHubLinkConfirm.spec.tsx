import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const startGitHub = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../github-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github-oauth')>()),
  startGitHubAuthorization: startGitHub,
}));

import { GitHubLinkConfirm } from './GitHubLinkConfirm';

global.fetch = vi.fn();

type Reply = { status?: number; body: unknown };
const reply = (...replies: Reply[]) => {
  const mock = vi.mocked(global.fetch);
  mock.mockReset();
  for (const { status = 200, body } of replies) {
    mock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body } as Response);
  }
};
const calls = () =>
  vi.mocked(global.fetch).mock.calls.map(([url, init]) => ({
    path: new URL(String(url)).pathname,
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  }));
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const identities = (extra: Record<string, unknown> = {}) => ({
  firebase: { linked: false, email: null },
  github: { linked: false, username: null },
  hasPassword: true,
  mfaEnabled: false,
  ...extra,
});

const renderConfirm = (purpose: 'link' | 'repos' = 'link') => {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <GitHubLinkConfirm
      purpose={purpose}
      code="oauth-code"
      state="oauth-state"
      accountEmail="ada@corp.com"
      onDone={onDone}
      onCancel={onCancel}
    />,
  );
  return { onDone, onCancel };
};

describe('GitHubLinkConfirm : retour GitHub avec la finalité link (P9, S31)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('n’appelle /auth/github/link qu’après la saisie du mot de passe', async () => {
    reply({ body: identities() }, { body: { githubUsername: 'ada-gh', repoAccess: false } });
    const { onDone } = renderConfirm();

    await screen.findByLabelText('Mot de passe Planner-Pro');
    // Rien n'est lié tant que l'utilisateur n'a pas confirmé : seule la lecture des identités
    expect(calls().map((c) => c.path)).toEqual(['/auth/identities']);
    expect(screen.getByText('ada@corp.com')).toBeInTheDocument();

    type('Mot de passe Planner-Pro', 'Secret-12345');
    fireEvent.click(screen.getByText('Confirmer la liaison GitHub'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls()[1]).toEqual({
      path: '/auth/github/link',
      body: { code: 'oauth-code', state: 'oauth-state', password: 'Secret-12345' },
    });
    expect(onDone.mock.calls[0][0]).toContain('ada-gh');
  });

  it('MFA active : envoie aussi mfaCode, ou recoveryCode après bascule', async () => {
    reply({ body: identities({ mfaEnabled: true }) }, { body: { githubUsername: 'ada-gh' } });
    const { onDone } = renderConfirm();
    await screen.findByLabelText('Mot de passe Planner-Pro');
    type('Mot de passe Planner-Pro', 'pw');
    type(/Code à 6 chiffres/, '123456');
    fireEvent.click(screen.getByText('Confirmer la liaison GitHub'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls()[1].body).toEqual({
      code: 'oauth-code',
      state: 'oauth-state',
      password: 'pw',
      mfaCode: '123456',
    });
  });

  it('MFA active, code de récupération : recoveryCode et pas mfaCode', async () => {
    reply({ body: identities({ mfaEnabled: true }) }, { body: { githubUsername: 'ada-gh' } });
    const { onDone } = renderConfirm();
    await screen.findByLabelText('Mot de passe Planner-Pro');
    fireEvent.click(screen.getByText('Utiliser un code de récupération'));
    type('Mot de passe Planner-Pro', 'pw');
    type('Code de récupération', 'ABCD-1234');
    fireEvent.click(screen.getByText('Confirmer la liaison GitHub'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const body = calls()[1].body;
    expect(body.recoveryCode).toBe('ABCD-1234');
    expect(body).not.toHaveProperty('mfaCode');
  });

  it('compte sans mot de passe : aucun champ mot de passe, rappel de la connexion récente', async () => {
    reply({ body: identities({ hasPassword: false }) }, { body: { githubUsername: 'x' } });
    const { onDone } = renderConfirm();
    await screen.findByText(/connexion de moins de 5 minutes/);
    expect(screen.queryByLabelText('Mot de passe Planner-Pro')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirmer la liaison GitHub'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls()[1].body).toEqual({ code: 'oauth-code', state: 'oauth-state' });
  });

  it('refus (403) : message affiché, pas de nouvel essai avec le même code, relance GitHub proposée', async () => {
    reply({ body: identities() }, { status: 403, body: { message: 'Mot de passe incorrect.' } });
    const { onDone } = renderConfirm();
    await screen.findByLabelText('Mot de passe Planner-Pro');
    type('Mot de passe Planner-Pro', 'mauvais');
    fireEvent.click(screen.getByText('Confirmer la liaison GitHub'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe incorrect.');
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByText('Confirmer la liaison GitHub')).not.toBeInTheDocument();
    expect(screen.getByText('Recommencer avec GitHub')).toBeInTheDocument();
    expect(calls().filter((c) => c.path === '/auth/github/link')).toHaveLength(1);
  });

  it('annuler ne lie rien', async () => {
    reply({ body: identities() });
    const { onCancel, onDone } = renderConfirm();
    await screen.findByLabelText('Mot de passe Planner-Pro');
    fireEvent.click(screen.getByText('Annuler'));
    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(calls().map((c) => c.path)).toEqual(['/auth/identities']);
  });

  it('finalité repos : le texte annonce l’accès aux dépôts', async () => {
    reply({ body: identities() });
    renderConfirm('repos');
    await screen.findByLabelText('Mot de passe Planner-Pro');
    expect(screen.getByText(/accès à vos dépôts/)).toBeInTheDocument();
  });

  it.each(['link', 'repos'] as const)(
    'finalité %s : « Recommencer avec GitHub » relance la même finalité (P9-L-d)',
    async (purpose) => {
      reply({ body: identities() }, { status: 403, body: { message: 'Mot de passe incorrect.' } });
      renderConfirm(purpose);
      await screen.findByLabelText('Mot de passe Planner-Pro');
      type('Mot de passe Planner-Pro', 'mauvais');
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer la liaison GitHub' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Recommencer avec GitHub' }));
      expect(startGitHub).toHaveBeenCalledTimes(1);
      expect(startGitHub).toHaveBeenCalledWith(purpose);
    },
  );
});
