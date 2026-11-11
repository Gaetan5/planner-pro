import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOO_MANY_REQUESTS_MESSAGE } from '../http-errors';
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

/** r48-m1 : `reportApiError` affiche le message du 429 du serveur, sinon le message générique. */
describe('AppContext : message d’un 429 (r48-m1)', () => {
  let ctx: ReturnType<typeof useApp>;
  const Probe = () => {
    ctx = useApp();
    return null;
  };

  const mount = (body: string) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const isCreate = init?.method === 'POST' && String(input).endsWith('/projects');
        if (isCreate) return new Response(body, { status: 429 });
        return new Response('[]', { status: 200 });
      }),
    );
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
  };

  const createProjectError = async () => {
    let error: unknown;
    await act(async () => {
      error = await ctx.createProject('P', 'd', 'w-1').catch((e: unknown) => e);
    });
    return error as Error;
  };

  beforeEach(() => {
    localStorage.setItem(
      'planner_user',
      JSON.stringify({ id: 'u-1', name: 'Ada', email: 'a@b.fr' }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('429 JSON en français : le message du serveur est affiché', async () => {
    mount(JSON.stringify({ message: 'Compte temporairement verrouillé, réessayez plus tard.' }));
    const error = await createProjectError();
    expect(error.message).toBe('Compte temporairement verrouillé, réessayez plus tard.');
    expect(ctx.apiError).toBe(error.message);
  });

  it('429 avec un tableau de messages : joint', async () => {
    mount(JSON.stringify({ message: ['réessayez dans une minute', 'merci'] }));
    expect((await createProjectError()).message).toBe('réessayez dans une minute merci');
  });

  it('429 page HTML de Nginx : message générique', async () => {
    mount('<html><body><h1>429 Too Many Requests</h1></body></html>');
    const error = await createProjectError();
    expect(error.message).toBe(TOO_MANY_REQUESTS_MESSAGE);
    expect(ctx.apiError).toBe(TOO_MANY_REQUESTS_MESSAGE);
  });

  it('429 corps vide : message générique', async () => {
    mount('');
    expect((await createProjectError()).message).toBe(TOO_MANY_REQUESTS_MESSAGE);
  });
});
