import { render, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from './AppContext';

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock('../firebase-auth', () => ({ signOutFirebase: vi.fn() }));

/**
 * S7 : aucun jeton n'est lisible par le JavaScript. La session vit dans des cookies httpOnly ;
 * localStorage ne garde que le profil.
 */
describe('AppContext : session sans jeton lisible (S7)', () => {
  let ctx: ReturnType<typeof useApp>;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const Probe = () => {
    ctx = useApp();
    return null;
  };

  beforeEach(() => {
    localStorage.clear();
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/auth/login')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              user: { id: 'u-1', name: 'Ada', email: 'ada@corp.com', platformRole: null },
            }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [], text: async () => '[]' } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('après la connexion, localStorage ne contient aucun jeton et aucun en-tête Authorization n’est envoyé', async () => {
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );

    await act(async () => {
      await ctx.classicLogin('ada@corp.com', 'MotDePasse!2026');
    });

    const stored = localStorage.getItem('planner_user')!;
    expect(JSON.parse(stored)).toEqual({
      id: 'u-1',
      name: 'Ada',
      email: 'ada@corp.com',
      platformRole: null,
    });
    expect(stored).not.toMatch(/token/i);
    expect(JSON.stringify(Object.entries(localStorage))).not.toMatch(
      /accessToken|refreshToken|Bearer/i,
    );

    await waitFor(() => expect(calls.some((c) => c.url.includes('/projects'))).toBe(true));
    for (const call of calls) {
      expect(JSON.stringify(call.init?.headers ?? {})).not.toMatch(/Authorization|Bearer/i);
    }
  });

  it('un ancien profil contenant un jeton est purgé au démarrage', async () => {
    localStorage.setItem(
      'planner_user',
      JSON.stringify({ id: 'u-1', name: 'Ada', email: 'ada@corp.com', token: 'ancien.jwt.secret' }),
    );

    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );

    await waitFor(() => expect(ctx.user?.id).toBe('u-1'));
    expect(localStorage.getItem('planner_user')).not.toMatch(/ancien\.jwt\.secret|token/);
  });

  it('la déconnexion appelle POST /auth/logout et vide le profil', async () => {
    localStorage.setItem(
      'planner_user',
      JSON.stringify({ id: 'u-1', name: 'Ada', email: 'ada@corp.com' }),
    );
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
    await waitFor(() => expect(ctx.user?.id).toBe('u-1'));

    act(() => ctx.logout());

    expect(calls.some((c) => c.url.endsWith('/auth/logout') && c.init?.method === 'POST')).toBe(
      true,
    );
    expect(localStorage.getItem('planner_user')).toBeNull();
    await waitFor(() => expect(ctx.user).toBeNull());
  });
});
