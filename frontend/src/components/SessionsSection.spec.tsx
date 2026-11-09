import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionsSection, describeUserAgent } from './SessionsSection';

global.fetch = vi.fn();

type Reply = { status?: number; body?: unknown };
const reply = (...replies: Reply[]) => {
  const mock = vi.mocked(global.fetch);
  mock.mockReset();
  for (const { status = 200, body = {} } of replies) {
    mock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body } as Response);
  }
};
const calls = () =>
  vi.mocked(global.fetch).mock.calls.map(([url, init]) => ({
    url: String(url),
    path: new URL(String(url)).pathname,
    method: (init as RequestInit | undefined)?.method,
    body: (init as RequestInit | undefined)?.body,
  }));

const CHROME_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FIREFOX_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt: '2026-11-01T10:00:00.000Z',
  authenticatedAt: '2026-11-01T10:00:00.000Z',
  expiresAt: '2026-11-08T10:00:00.000Z',
  userAgent: CHROME_LINUX,
  current: false,
  ...extra,
});

const CURRENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

describe('SessionsSection (P9-S)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('liste les sessions : navigateur lisible, badge, pas de « Révoquer » sur la courante', async () => {
    reply({
      body: [session(CURRENT, { current: true }), session(OTHER, { userAgent: FIREFOX_WIN })],
    });
    render(<SessionsSection />);
    expect(await screen.findByText('Chrome sur Linux')).toBeInTheDocument();
    expect(screen.getByText('Firefox sur Windows')).toBeInTheDocument();
    expect(screen.getByText('Cette session')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Révoquer' })).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ path: '/auth/sessions', method: 'GET' });
  });

  it('revoque une session : confirmation, DELETE avec le sid encodé, puis liste relue', async () => {
    const odd = 'a/b c?d';
    reply(
      { body: [session(CURRENT, { current: true }), session(odd)] },
      { status: 204 },
      { body: [session(CURRENT, { current: true })] },
    );
    render(<SessionsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer' }));
    // Rien n'est appelé avant la confirmation
    expect(calls()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(calls()).toHaveLength(3));
    expect(calls()[1]).toMatchObject({ method: 'DELETE' });
    expect(calls()[1].url.endsWith(`/auth/sessions/${encodeURIComponent(odd)}`)).toBe(true);
    expect(calls()[2]).toMatchObject({ path: '/auth/sessions', method: 'GET' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Révoquer' })).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Session fermée.');
  });

  it('annuler la confirmation n’appelle rien', async () => {
    reply({ body: [session(CURRENT, { current: true }), session(OTHER)] });
    render(<SessionsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(calls()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Révoquer' })).toBeInTheDocument();
  });

  it('un 404 affiche une erreur et relit la liste', async () => {
    reply(
      { body: [session(CURRENT, { current: true }), session(OTHER)] },
      { status: 404, body: { message: 'Session introuvable.' } },
      { body: [session(CURRENT, { current: true })] },
    );
    render(<SessionsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Session introuvable.');
    await waitFor(() => expect(calls()).toHaveLength(3));
    expect(calls()[2]).toMatchObject({ path: '/auth/sessions', method: 'GET' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Révoquer' })).toBeNull());
  });

  it('« Fermer les autres sessions » : POST sans corps, notice « n sessions fermées », liste relue', async () => {
    reply(
      {
        body: [session(CURRENT, { current: true }), session(OTHER), session(THIRD)],
      },
      { body: { revoked: 2 } },
      { body: [session(CURRENT, { current: true })] },
    );
    render(<SessionsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fermer les autres sessions' }));
    expect(await screen.findByText('2 sessions fermées.')).toBeInTheDocument();
    expect(calls()[1]).toMatchObject({
      path: '/auth/sessions/revoke-others',
      method: 'POST',
      body: undefined,
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Fermer les autres sessions' })).toBeNull(),
    );
  });

  it('bouton « Fermer les autres sessions » absent s’il n’y a que la session courante', async () => {
    reply({ body: [session(CURRENT, { current: true })] });
    render(<SessionsSection />);
    await screen.findByText('Cette session');
    expect(screen.queryByRole('button', { name: 'Fermer les autres sessions' })).toBeNull();
  });

  it('en impersonation : liste visible, aucune action', async () => {
    sessionStorage.setItem('planner_admin_original_session', '{}');
    reply({ body: [session(CURRENT, { current: true }), session(OTHER)] });
    render(<SessionsSection />);
    expect(await screen.findAllByText('Chrome sur Linux')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Révoquer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fermer les autres sessions' })).toBeNull();
  });

  it('relit la liste quand refreshKey change', async () => {
    reply(
      { body: [session(CURRENT, { current: true })] },
      { body: [session(CURRENT, { current: true })] },
    );
    const { rerender } = render(<SessionsSection refreshKey={0} />);
    await screen.findByText('Cette session');
    rerender(<SessionsSection refreshKey={1} />);
    await waitFor(() => expect(calls()).toHaveLength(2));
  });

  it('affiche l’erreur du chargement', async () => {
    reply({ status: 500, body: { message: 'Erreur serveur' } });
    render(<SessionsSection />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Erreur serveur')).toBeInTheDocument();
  });

  it('describeUserAgent : repli tronqué à 120 caractères, valeur absente', () => {
    expect(describeUserAgent(null)).toBe('Appareil inconnu');
    expect(describeUserAgent('x'.repeat(300))).toBe(`${'x'.repeat(120)}…`);
    expect(describeUserAgent('Mozilla/5.0 (iPhone) Safari/604.1')).toBe('Safari sur iOS');
  });
});
