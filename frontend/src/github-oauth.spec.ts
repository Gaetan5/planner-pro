import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGitHubPurpose, linkGitHub, startGitHubAuthorization } from './github-oauth';

describe('startGitHubAuthorization (S9)', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost:3000/' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.unstubAllGlobals();
  });

  it('demande l’URL au serveur (state généré côté serveur) puis redirige vers GitHub', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'https://github.com/login/oauth/authorize?scope=read%3Auser+user%3Aemail&state=abc',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await startGitHubAuthorization();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/github/authorize?purpose=login'),
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(window.location.href).toContain('github.com/login/oauth/authorize');
    expect(window.location.href).not.toMatch(/scope=user[,%]|repo/);
  });

  it('la portée repo n’est demandée que pour « connecter un dépôt »', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ url: 'https://x' }) });
    vi.stubGlobal('fetch', fetchMock);
    await startGitHubAuthorization('repos');
    expect(fetchMock.mock.calls[0][0]).toContain('purpose=repos');
  });

  it('erreur serveur : pas de redirection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(startGitHubAuthorization()).rejects.toThrow();
    expect(window.location.href).toBe('http://localhost:3000/');
  });
});

describe('routage du retour GitHub selon la finalité (S9-b)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchGitHubPurpose lit la finalité signée par le serveur', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ purpose: 'link' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchGitHubPurpose()).resolves.toBe('link');
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/github/pending');
  });

  it('cookie absent ou expiré : erreur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(fetchGitHubPurpose()).rejects.toThrow();
  });

  it('linkGitHub appelle /auth/github/link (et non /login) avec code et state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await linkGitHub('c', 's');
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/github/link');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: 'c', state: 's' });
  });
});
