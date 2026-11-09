import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startGitHub = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../github-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github-oauth')>()),
  startGitHubAuthorization: startGitHub,
}));

import { GitHubRepoConnector } from './GitHubRepoConnector';
import { PENDING_REPO_KEY } from '../pending-repo';

global.fetch = vi.fn();

const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const repos = [
  { id: 1, name: 'api', fullName: 'acme/api', description: null, private: true },
  { id: 2, name: 'web', fullName: 'acme/web', description: null, private: false },
];

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
    url: String(url),
    method: (init as RequestInit | undefined)?.method ?? 'GET',
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  }));

describe('GitHubRepoConnector : « Connecter un dépôt » (P9-R)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('sans droit project.manage : aucun bouton, aucun appel', () => {
    render(<GitHubRepoConnector projectId={ID} canManage={false} />);
    expect(screen.queryByRole('button', { name: 'Connecter un dépôt' })).toBeNull();
    expect(calls()).toEqual([]);
  });

  it('affiche le dépôt déjà lié', () => {
    render(<GitHubRepoConnector projectId={ID} currentRepo="acme/api" canManage />);
    expect(screen.getByText(/Dépôt lié : acme\/api/)).toBeInTheDocument();
  });

  it('200 : le sélecteur s’ouvre, puis sync reçoit le projet et le dépôt dans le corps, jamais dans le chemin', async () => {
    const onLinked = vi.fn();
    render(<GitHubRepoConnector projectId={ID} canManage onLinked={onLinked} />);
    reply({ body: repos }, { body: { id: ID, githubRepo: 'acme/web' } });

    fireEvent.click(screen.getByRole('button', { name: 'Connecter un dépôt' }));
    expect(await screen.findByText('acme/api')).toBeInTheDocument();
    expect(screen.getByText(/dépôts privés/)).toBeInTheDocument();
    expect(startGitHub).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Lier acme/web' }));
    expect(await screen.findByText(/Dépôt lié : acme\/web/)).toBeInTheDocument();

    const [list, sync] = calls();
    expect(list.url).toMatch(/\/auth\/github\/repos$/);
    expect(sync.method).toBe('POST');
    expect(sync.url).toMatch(/\/auth\/github\/sync$/);
    expect(sync.url).not.toContain('acme');
    expect(sync.body).toEqual({ projectId: ID, repoFullName: 'acme/web' });
    expect(onLinked).toHaveBeenCalledWith('acme/web');
  });

  it.each([400, 403])(
    '%i : projet mémorisé dans sessionStorage puis autorisation GitHub « repos »',
    async (status) => {
      render(<GitHubRepoConnector projectId={ID} canManage />);
      reply({ status, body: { message: 'Aucun compte GitHub connecté.' } });

      fireEvent.click(screen.getByRole('button', { name: 'Connecter un dépôt' }));
      await waitFor(() => expect(startGitHub).toHaveBeenCalledWith('repos'));

      const stored = JSON.parse(sessionStorage.getItem(PENDING_REPO_KEY) as string);
      expect(stored.projectId).toBe(ID);
      expect(stored.expiresAt).toBeGreaterThan(Date.now());
      expect(localStorage.getItem(PENDING_REPO_KEY)).toBeNull();
    },
  );

  it('401 (session) : aucun détour par GitHub, message affiché, rien en mémoire', async () => {
    render(<GitHubRepoConnector projectId={ID} canManage />);
    reply({ status: 401, body: { message: 'Unauthorized' } });

    fireEvent.click(screen.getByRole('button', { name: 'Connecter un dépôt' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(startGitHub).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
  });

  it('le dépôt affiché après la liaison est celui renvoyé par le serveur, pas la sélection', async () => {
    render(<GitHubRepoConnector projectId={ID} canManage />);
    reply({ body: repos }, { body: { id: ID, githubRepo: 'Acme/Web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connecter un dépôt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lier acme/web' }));
    expect(await screen.findByText(/Dépôt lié : Acme\/Web/)).toBeInTheDocument();
    expect(screen.queryByText(/Dépôt lié : acme\/web/)).toBeNull();
  });

  it('autre erreur (503) : message affiché, aucun détour par GitHub, rien en mémoire', async () => {
    render(<GitHubRepoConnector projectId={ID} canManage />);
    reply({ status: 503, body: { message: 'GitHub est injoignable, réessayez plus tard.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Connecter un dépôt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub est injoignable');
    expect(startGitHub).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
  });

  it('identifiant de projet invalide : ni mémorisation ni autorisation GitHub', async () => {
    render(<GitHubRepoConnector projectId="project-1" canManage />);
    reply({ status: 400, body: { message: 'Aucun compte GitHub connecté.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Connecter un dépôt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Projet invalide');
    expect(startGitHub).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
  });

  it('refus du serveur à la liaison (400) : erreur affichée, le dépôt affiché ne change pas', async () => {
    render(<GitHubRepoConnector projectId={ID} currentRepo="acme/old" canManage />);
    reply(
      { body: repos },
      {
        status: 400,
        body: { message: 'Dépôt introuvable ou inaccessible avec votre compte GitHub.' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connecter un dépôt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lier acme/api' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dépôt introuvable');
    expect(screen.getByText(/Dépôt lié : acme\/old/)).toBeInTheDocument();
  });

  it('retour de GitHub : le sélecteur s’ouvre seul, une seule fois', async () => {
    reply({ body: repos });
    const onAutoOpened = vi.fn();
    const { rerender } = render(
      <GitHubRepoConnector projectId={ID} canManage autoOpen onAutoOpened={onAutoOpened} />,
    );
    expect(await screen.findByText('acme/api')).toBeInTheDocument();
    rerender(
      <GitHubRepoConnector projectId={ID} canManage autoOpen onAutoOpened={() => onAutoOpened()} />,
    );
    expect(onAutoOpened).toHaveBeenCalledTimes(1);
    expect(calls()).toHaveLength(1);
  });

  it('retour de GitHub sans droit : aucun appel, aucun sélecteur', () => {
    const onAutoOpened = vi.fn();
    render(
      <GitHubRepoConnector projectId={ID} canManage={false} autoOpen onAutoOpened={onAutoOpened} />,
    );
    expect(onAutoOpened).toHaveBeenCalledTimes(1);
    expect(calls()).toEqual([]);
  });
});
