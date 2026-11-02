import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSsoState, startSsoAuthorization } from './sso-oauth';

describe('SSO côté navigateur (S10)', () => {
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

  it('demande l’URL au serveur (cookies inclus) puis redirige vers l’IdP', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://idp.example/authorize' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await startSsoAuthorization('acme.com');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/sso/authorize?domain=acme.com'),
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(window.location.href).toBe('https://idp.example/authorize');
    expect(fetchMock.mock.calls[0][0]).not.toContain('redirectUri');
  });

  it('erreur serveur : pas de redirection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(startSsoAuthorization('acme.com')).rejects.toThrow();
    expect(window.location.href).toBe('http://localhost:3000/');
  });

  it('reconnaît un state SSO par son préfixe', () => {
    expect(isSsoState('sso_abc')).toBe(true);
    expect(isSsoState('abc')).toBe(false);
    expect(isSsoState(null)).toBe(false);
  });
});
