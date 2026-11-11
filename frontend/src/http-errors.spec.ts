import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPasswordReset } from './account-api';
import { linkGitHub } from './github-oauth';
import { TOO_MANY_REQUESTS_MESSAGE, apiErrorMessage, readApiError } from './http-errors';
import { invitationErrorFrom } from './invitation-store';
import { SecurityApiError, getMfaStatus } from './security-api';

const reply = (status: number, body: string) =>
  vi.fn().mockResolvedValue(new Response(body, { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const LOCK = 'Compte temporairement verrouillé, réessayez plus tard.';
const lockBody = JSON.stringify({ statusCode: 429, message: LOCK });
const HTML = '<html><body><h1>429 Too Many Requests</h1></body></html>';

describe('r47-m2, r48-m1 : 429, message du serveur sinon message générique', () => {
  it('apiErrorMessage : message serveur conservé, repli générique si absent ou vide', () => {
    expect(apiErrorMessage(429, LOCK, 'x')).toBe(LOCK);
    expect(apiErrorMessage(429, ['a', 'b'], 'x')).toBe('a b');
    expect(apiErrorMessage(429, undefined, 'x')).toBe(TOO_MANY_REQUESTS_MESSAGE);
    expect(apiErrorMessage(429, '  ', 'x')).toBe(TOO_MANY_REQUESTS_MESSAGE);
    expect(apiErrorMessage(429, [], 'x')).toBe(TOO_MANY_REQUESTS_MESSAGE);
  });

  it('apiErrorMessage conserve le message serveur pour les autres statuts', () => {
    expect(apiErrorMessage(400, ['a', 'b'], 'x')).toBe('a b');
    expect(apiErrorMessage(500, undefined, 'repli')).toBe('repli');
  });

  it('readApiError : 429 JSON en français (verrouillage), tableau, HTML de Nginx, corps vide', async () => {
    expect(await readApiError(new Response(lockBody, { status: 429 }), 'x')).toBe(LOCK);
    const tableau = JSON.stringify({ message: ['réessayez dans une minute', 'merci'] });
    expect(await readApiError(new Response(tableau, { status: 429 }), 'x')).toBe(
      'réessayez dans une minute merci',
    );
    expect(await readApiError(new Response(HTML, { status: 429 }), 'x')).toBe(
      TOO_MANY_REQUESTS_MESSAGE,
    );
    expect(await readApiError(new Response('', { status: 429 }), 'x')).toBe(
      TOO_MANY_REQUESTS_MESSAGE,
    );
    expect(await readApiError(new Response('{}', { status: 429 }), 'x')).toBe(
      TOO_MANY_REQUESTS_MESSAGE,
    );
    expect(await readApiError(new Response('pas du JSON', { status: 500 }), 'repli')).toBe('repli');
  });

  it('le client de sécurité affiche le message serveur et conserve le statut', async () => {
    vi.stubGlobal('fetch', reply(429, lockBody));
    const error = await getMfaStatus().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SecurityApiError);
    expect((error as SecurityApiError).message).toBe(LOCK);
    expect((error as SecurityApiError).status).toBe(429);
  });

  it('le client de sécurité retombe sur le message générique pour une page HTML', async () => {
    vi.stubGlobal('fetch', reply(429, HTML));
    const error = await getMfaStatus().catch((e: unknown) => e);
    expect((error as SecurityApiError).message).toBe(TOO_MANY_REQUESTS_MESSAGE);
    expect((error as SecurityApiError).status).toBe(429);
  });

  it('les parcours de compte, GitHub et invitation suivent la même règle', async () => {
    vi.stubGlobal('fetch', reply(429, lockBody));
    await expect(requestPasswordReset('a@b.fr')).rejects.toThrow(LOCK);
    vi.stubGlobal('fetch', reply(429, HTML));
    await expect(linkGitHub('c', 's')).rejects.toThrow(TOO_MANY_REQUESTS_MESSAGE);
    const serveur = await invitationErrorFrom(new Response(lockBody, { status: 429 }), 'repli');
    expect(serveur.message).toBe(LOCK);
    const vide = await invitationErrorFrom(new Response('', { status: 429 }), 'repli');
    expect(vide.message).toBe(TOO_MANY_REQUESTS_MESSAGE);
  });

  it('invitationErrorFrom : 429 HTML de Nginx donne le message générique, 429 JSON conservé, 403 texte brut inchangé', async () => {
    const html = await invitationErrorFrom(
      new Response('<html><h1>429 Too Many Requests</h1></html>', { status: 429 }),
      'repli',
    );
    expect(html.message).toBe(TOO_MANY_REQUESTS_MESSAGE);
    const json = await invitationErrorFrom(
      new Response(JSON.stringify({ message: 'Compte verrouillé.' }), { status: 429 }),
      'repli',
    );
    expect(json.message).toBe('Compte verrouillé.');
    const brut = await invitationErrorFrom(new Response('Accès refusé', { status: 403 }), 'repli');
    expect(brut.message).toBe('Accès refusé');
  });
});
