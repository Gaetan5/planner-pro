import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOutFirebase: vi.fn().mockResolvedValue(undefined),
  startGitHub: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../firebase-config', () => ({ isFirebaseAuthConfigured: true }));
vi.mock('../firebase-auth', () => ({
  getFirebaseAuth: () => ({}),
  signOutFirebase: firebaseMocks.signOutFirebase,
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: firebaseMocks.signIn,
  reload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../github-oauth', () => ({ startGitHubAuthorization: firebaseMocks.startGitHub }));

import { IdentitiesSection } from './IdentitiesSection';

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
    method: (init as RequestInit | undefined)?.method,
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  }));
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

const identities = (extra: Record<string, unknown> = {}) => ({
  firebase: { linked: false, email: null },
  github: { linked: false, username: null },
  hasPassword: true,
  mfaEnabled: false,
  canUnlink: { firebase: false, github: false },
  ...extra,
});

const credential = (email: string, emailVerified = true) => ({
  user: { email, emailVerified, getIdToken: async () => 'fb-id-token' },
});

describe('IdentitiesSection : liaison et déliaison (P9, S31)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GitHub non lié : « Lier GitHub » démarre l’autorisation avec la finalité link, sans appel de liaison', async () => {
    reply({ body: identities() });
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('Identités liées');
    click(/Lier GitHub/);
    await waitFor(() => expect(firebaseMocks.startGitHub).toHaveBeenCalledWith('link'));
    expect(calls().map((c) => c.path)).toEqual(['/auth/identities']);
  });

  it('Firebase : l’adresse liée est affichée avant confirmation et rien n’est envoyé avant la preuve', async () => {
    firebaseMocks.signIn.mockResolvedValue(credential('perso@example.com'));
    reply(
      { body: identities() },
      { body: identities() },
      { body: { firebaseEmail: 'perso@example.com' } },
      {
        body: identities({ firebase: { linked: true, email: 'perso@example.com' } }),
      },
    );
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('Identités liées');
    click(/Lier Firebase/);
    type('E-mail Firebase', 'perso@example.com');
    type('Mot de passe Firebase', 'fb-secret');
    click('Continuer');

    await screen.findByRole('form', { name: 'Confirmation de la liaison Firebase' });
    expect(screen.getByText('perso@example.com')).toBeInTheDocument();
    // Adresse différente de celle du compte : avertissement explicite
    expect(screen.getByRole('alert')).toHaveTextContent('différente de celle de votre compte');
    // Aucun appel de liaison tant que l'utilisateur n'a pas confirmé
    expect(calls().map((c) => c.path)).not.toContain('/auth/firebase/link');
    // La session Firebase du navigateur est refermée, le mot de passe Firebase n'est pas envoyé
    expect(firebaseMocks.signOutFirebase).toHaveBeenCalled();

    type('Mot de passe Planner-Pro', 'Secret-12345');
    click('Confirmer la liaison Firebase');
    await screen.findByText(/Compte Firebase perso@example.com associé/);

    expect(calls()[2]).toEqual({
      path: '/auth/firebase/link',
      method: 'POST',
      body: { idToken: 'fb-id-token', password: 'Secret-12345' },
    });
    expect(JSON.stringify(calls())).not.toContain('fb-secret');
  });

  it('Firebase : pas d’avertissement quand l’adresse est celle du compte (casse ignorée)', async () => {
    firebaseMocks.signIn.mockResolvedValue(credential('ADA@corp.com'));
    reply({ body: identities() }, { body: identities() });
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('Identités liées');
    click(/Lier Firebase/);
    type('E-mail Firebase', 'ADA@corp.com');
    type('Mot de passe Firebase', 'x');
    click('Continuer');
    await screen.findByRole('form', { name: 'Confirmation de la liaison Firebase' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Firebase : adresse non vérifiée refusée, aucune confirmation ni appel de liaison', async () => {
    firebaseMocks.signIn.mockResolvedValue(credential('perso@example.com', false));
    reply({ body: identities() });
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('Identités liées');
    click(/Lier Firebase/);
    type('E-mail Firebase', 'perso@example.com');
    type('Mot de passe Firebase', 'x');
    click('Continuer');
    expect(await screen.findByRole('alert')).toHaveTextContent('non vérifiée');
    expect(screen.queryByRole('form', { name: /Confirmation/ })).not.toBeInTheDocument();
    expect(calls().map((c) => c.path)).toEqual(['/auth/identities']);
  });

  it('« Délier » est désactivé, avec explication, pour la dernière méthode de connexion', async () => {
    reply({
      body: identities({
        hasPassword: false,
        github: { linked: true, username: 'ada-gh' },
        canUnlink: { firebase: false, github: false },
      }),
    });
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('ada-gh');
    expect(screen.getByRole('button', { name: /Délier/ })).toBeDisabled();
    expect(screen.getByText(/Dernière méthode de connexion/)).toBeInTheDocument();
  });

  it('« Délier » suit canUnlink du serveur : actif pour une seule identité sans mot de passe (SSO)', async () => {
    reply({
      body: identities({
        hasPassword: false,
        github: { linked: true, username: 'ada-gh' },
        canUnlink: { firebase: false, github: true },
      }),
    });
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('ada-gh');
    expect(screen.getByRole('button', { name: /Délier/ })).toBeEnabled();
  });

  it('« Délier » reste actif avec deux identités liées, même sans mot de passe', async () => {
    reply({
      body: identities({
        hasPassword: false,
        github: { linked: true, username: 'ada-gh' },
        firebase: { linked: true, email: 'p@e.fr' },
        canUnlink: { firebase: true, github: true },
      }),
    });
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('ada-gh');
    for (const button of screen.getAllByRole('button', { name: /Délier/ })) {
      expect(button).toBeEnabled();
    }
  });

  it('déliaison GitHub : preuve (mot de passe + code MFA) envoyée à /auth/github/unlink, notice affichée', async () => {
    const linkedMfa = identities({
      mfaEnabled: true,
      github: { linked: true, username: 'ada-gh' },
      canUnlink: { firebase: false, github: true },
    });
    reply(
      { body: linkedMfa },
      { body: linkedMfa },
      { status: 204, body: {} },
      { body: identities({ mfaEnabled: true }) },
    );
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('ada-gh');
    click(/Délier/);
    await screen.findByLabelText('Mot de passe Planner-Pro');
    type('Mot de passe Planner-Pro', 'Secret-12345');
    type(/Code à 6 chiffres/, '654321');
    click('Confirmer la déliaison');

    await screen.findByText(/Compte GitHub délié/);
    expect(calls()[2]).toEqual({
      path: '/auth/github/unlink',
      method: 'POST',
      body: { password: 'Secret-12345', mfaCode: '654321' },
    });
  });

  it('déliaison refusée (403) : l’identité reste affichée et l’erreur est montrée', async () => {
    const linkedGh = identities({
      github: { linked: true, username: 'ada-gh' },
      canUnlink: { firebase: false, github: true },
    });
    reply(
      { body: linkedGh },
      { body: linkedGh },
      { status: 403, body: { message: 'Mot de passe incorrect.' } },
    );
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('ada-gh');
    click(/Délier/);
    await screen.findByLabelText('Mot de passe Planner-Pro');
    type('Mot de passe Planner-Pro', 'mauvais');
    click('Confirmer la déliaison');
    expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe incorrect.');
    expect(screen.getByText('ada-gh')).toBeInTheDocument();
  });

  const linkedGh = {
    github: { linked: true, username: 'ada-gh' },
    canUnlink: { firebase: false, github: true },
  };

  it('MFA activée entre-temps (P9-L-b) : le champ de code apparaît à l’ouverture de « Délier » et mfaCode est envoyé', async () => {
    reply(
      { body: identities({ ...linkedGh, mfaEnabled: false }) },
      { body: identities({ ...linkedGh, mfaEnabled: true }) },
      { status: 204, body: {} },
      { body: identities() },
    );
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('ada-gh');
    click(/Délier/);
    await screen.findByLabelText(/Code à 6 chiffres/);
    type('Mot de passe Planner-Pro', 'pw');
    type(/Code à 6 chiffres/, '111222');
    click('Confirmer la déliaison');
    await screen.findByText(/Compte GitHub délié/);
    expect(calls()[2].body).toEqual({ password: 'pw', mfaCode: '111222' });
  });

  it('MFA activée entre-temps (P9-L-b) : même relecture avant la confirmation Firebase', async () => {
    firebaseMocks.signIn.mockResolvedValue(credential('perso@example.com'));
    reply(
      { body: identities({ mfaEnabled: false }) },
      { body: identities({ mfaEnabled: true }) },
      { body: { firebaseEmail: 'perso@example.com' } },
      { body: identities() },
    );
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('Identités liées');
    click(/Lier Firebase/);
    type('E-mail Firebase', 'perso@example.com');
    type('Mot de passe Firebase', 'x');
    click('Continuer');
    await screen.findByRole('form', { name: 'Confirmation de la liaison Firebase' });
    type('Mot de passe Planner-Pro', 'pw');
    type(/Code à 6 chiffres/, '333444');
    click('Confirmer la liaison Firebase');
    await screen.findByText(/Compte Firebase perso@example.com associé/);
    expect(calls()[2].body).toEqual({ idToken: 'fb-id-token', password: 'pw', mfaCode: '333444' });
  });

  it('MFA désactivée entre-temps (P9-L-b) : plus de champ de code inutile', async () => {
    reply(
      { body: identities({ ...linkedGh, mfaEnabled: true }) },
      { body: identities({ ...linkedGh, mfaEnabled: false }) },
    );
    render(<IdentitiesSection accountEmail="ada@corp.com" />);
    await screen.findByText('ada-gh');
    click(/Délier/);
    await screen.findByLabelText('Mot de passe Planner-Pro');
    expect(screen.queryByLabelText(/Code à 6 chiffres/)).not.toBeInTheDocument();
  });

  it('la notice du parcours précédent est transmise puis consommée (P9-L-c)', async () => {
    reply({ body: identities() });
    const onNoticeShown = vi.fn();
    render(
      <IdentitiesSection
        accountEmail="ada@corp.com"
        notice="Compte GitHub x associé."
        onNoticeShown={onNoticeShown}
      />,
    );
    expect(await screen.findByText('Compte GitHub x associé.')).toBeInTheDocument();
    expect(onNoticeShown).toHaveBeenCalledTimes(1);
  });
});
