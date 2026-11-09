import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_EXPIRED_EVENT } from '../api-session';
import { PENDING_INVITE_KEY, savePendingInvite } from '../invitation-store';
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

const VALID = 'e'.repeat(64);

describe('AppContext : invitations, aucune valeur externe dans le chemin (S32)', () => {
  let ctx: ReturnType<typeof useApp>;
  let urls: string[];
  let calls: Array<{ url: string; init?: RequestInit }>;

  const Probe = () => {
    ctx = useApp();
    return null;
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    urls = [];
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input));
        calls.push({ url: String(input), init });
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '{}',
        } as Response;
      }),
    );
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['../../../auth/logout', '..%2F..%2Fauth%2Flogout', 'a/b', '', 'D'.repeat(64)])(
    'jeton %j : checkInvitation et acceptInvitation refusent sans émettre de requête',
    async (token) => {
      const before = urls.length;
      await expect(ctx.checkInvitation(token)).rejects.toThrow(/invalide/);
      await expect(ctx.acceptInvitation(token)).rejects.toThrow(/invalide/);
      expect(urls.length).toBe(before);
      expect(urls.slice(before)).toEqual([]);
    },
  );

  it('jeton valide : POST sur /projects/invitations/check|accept, jeton dans le corps et jamais dans l’URL', async () => {
    const before = calls.length;
    await act(async () => {
      await ctx.checkInvitation(VALID);
      await ctx.acceptInvitation(VALID);
    });
    const mine = calls.slice(before).filter((c) => c.url.includes('/projects/invitations/'));
    expect(mine).toHaveLength(2);
    expect(mine[0].url).toMatch(/\/projects\/invitations\/check$/);
    expect(mine[1].url).toMatch(/\/projects\/invitations\/accept$/);
    for (const call of mine) {
      expect(call.init?.method).toBe('POST');
      expect(JSON.parse(String(call.init?.body))).toEqual({ token: VALID });
    }
    expect(urls.some((u) => u.includes(VALID))).toBe(false);
  });
});

describe('AppContext : déconnexion et invitation en attente (P13-f, question 3)', () => {
  let ctx: ReturnType<typeof useApp>;
  const Probe = () => {
    ctx = useApp();
    return null;
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as Response),
    );
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SESSION_EXPIRED_EVENT déconnecte mais conserve l’invitation en attente', async () => {
    savePendingInvite(VALID);
    await act(async () => {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    });
    expect(ctx.user).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(PENDING_INVITE_KEY)!).token).toBe(VALID);
  });
});
