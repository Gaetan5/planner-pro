import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'http://localhost:3001';

/**
 * S7 : le `fetch` de session envoie les cookies, renouvelle la session une fois sur un 401
 * (mono-vol) et signale la fin de session. Le module est ré-importé à chaque test.
 */
describe('api-session : fetch de session', () => {
  let native: ReturnType<typeof vi.fn>;
  let originalFetch: typeof window.fetch;

  const respond = (status: number, body: unknown = {}) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

  beforeEach(async () => {
    originalFetch = window.fetch;
    native = vi.fn();
    window.fetch = native as unknown as typeof window.fetch;
    vi.resetModules();
    const mod = await import('./api-session');
    mod.installSessionFetch();
  });

  afterEach(() => {
    window.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('envoie les cookies (credentials: include) vers l’API, pas vers un autre hôte', async () => {
    native.mockResolvedValue(respond(200));
    await window.fetch(`${API}/projects`);
    await window.fetch('https://cdn.example.com/x.js');

    expect(native.mock.calls[0][1]).toEqual(expect.objectContaining({ credentials: 'include' }));
    expect(native.mock.calls[1][1]?.credentials).toBeUndefined();
  });

  it('un 401 déclenche une seule rotation puis rejoue la requête', async () => {
    native
      .mockResolvedValueOnce(respond(401))
      .mockResolvedValueOnce(respond(201)) // POST /auth/refresh
      .mockResolvedValueOnce(respond(200, { ok: true }));

    const res = await window.fetch(`${API}/projects`);

    expect(res.status).toBe(200);
    expect(native.mock.calls[1][0]).toBe(`${API}/auth/refresh`);
    expect(native.mock.calls[1][1]).toEqual(
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(native).toHaveBeenCalledTimes(3);
  });

  it('plusieurs 401 simultanés ne provoquent qu’une seule rotation', async () => {
    let refreshCalls = 0;
    native.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return respond(201);
      }
      return native.mock.calls.filter((call) => call[0] === url).length <= 3
        ? respond(401)
        : respond(200);
    });

    await Promise.all([
      window.fetch(`${API}/projects`),
      window.fetch(`${API}/projects`),
      window.fetch(`${API}/projects`),
    ]);

    expect(refreshCalls).toBe(1);
  });

  it('rotation impossible : 401 d’origine renvoyé et événement de fin de session', async () => {
    native.mockResolvedValueOnce(respond(401)).mockResolvedValueOnce(respond(401));
    const expired = vi.fn();
    window.addEventListener('planner:session-expired', expired);

    const res = await window.fetch(`${API}/projects`);

    expect(res.status).toBe(401);
    expect(expired).toHaveBeenCalledTimes(1);
    window.removeEventListener('planner:session-expired', expired);
  });

  it.each(['/auth/login', '/auth/mfa/challenge', '/auth/refresh', '/auth/github/login'])(
    'un 401 sur %s ne déclenche jamais de rotation',
    async (path) => {
      native.mockResolvedValue(respond(401));
      const res = await window.fetch(`${API}${path}`, { method: 'POST' });
      expect(res.status).toBe(401);
      expect(native).toHaveBeenCalledTimes(1);
    },
  );

  it('rotation en 409 (autre onglet) : considérée réussie, la requête est rejouée', async () => {
    native
      .mockResolvedValueOnce(respond(401))
      .mockResolvedValueOnce(respond(409))
      .mockResolvedValueOnce(respond(200));
    const res = await window.fetch(`${API}/projects`);
    expect(res.status).toBe(200);
  });
});
