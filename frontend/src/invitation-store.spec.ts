import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PENDING_INVITE_KEY,
  PENDING_INVITE_TTL_MS,
  captureInviteFromUrl,
  readPendingInvite,
  savePendingInvite,
} from './invitation-store';

describe('invitation en attente (P13-a)', () => {
  it('l’échéance est de 30 minutes', () => {
    expect(PENDING_INVITE_TTL_MS).toBe(1_800_000);
  });

  const originalHref = window.location.href;
  beforeEach(() => sessionStorage.clear());
  afterEach(() => window.history.replaceState({}, '', originalHref));

  it.each(['token', 'invite'])(
    '?%s= est retiré de l’URL dès la lecture et conservé en sessionStorage',
    (param) => {
      window.history.replaceState(
        {},
        '',
        `/?${param}=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc&autre=1#h`,
      );
      expect(captureInviteFromUrl()).toBe(
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      );
      expect(window.location.search).toBe('?autre=1');
      expect(window.location.hash).toBe('#h');
      const stored = JSON.parse(sessionStorage.getItem(PENDING_INVITE_KEY)!);
      expect(stored.token).toBe('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
      expect(stored.expiresAt - Date.now()).toBeLessThanOrEqual(PENDING_INVITE_TTL_MS);
      expect(stored.expiresAt - Date.now()).toBeGreaterThan(PENDING_INVITE_TTL_MS - 5000);
      // Jamais en localStorage
      expect(localStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
      expect(JSON.stringify({ ...localStorage })).not.toContain(
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      );
    },
  );

  it('sans jeton dans l’URL : rien n’est enregistré', () => {
    window.history.replaceState({}, '', '/?code=x&state=y');
    expect(captureInviteFromUrl()).toBeNull();
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('lecture : valide avant 30 minutes, expirée et supprimée ensuite', () => {
    savePendingInvite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1_000);
    expect(readPendingInvite(1_000 + PENDING_INVITE_TTL_MS - 1)).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(readPendingInvite(1_000 + PENDING_INVITE_TTL_MS)).toBeNull();
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('entrée illisible : ignorée et supprimée', () => {
    sessionStorage.setItem(PENDING_INVITE_KEY, '{pas du json');
    expect(readPendingInvite()).toBeNull();
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });
});

describe('jeton d’invitation : format imposé (S32)', () => {
  const originalHref = window.location.href;
  const VALID = 'd'.repeat(64);
  beforeEach(() => sessionStorage.clear());
  afterEach(() => window.history.replaceState({}, '', originalHref));

  it.each([
    ['traversée de chemin', '../../auth/logout'],
    ['traversée encodée', '%2e%2e%2f%2e%2e%2fauth%2flogout'],
    ['deux points', '..'],
    ['trop court', 'abc123'],
    ['majuscules', 'D'.repeat(64)],
    ['64 caractères non hexadécimaux', 'z'.repeat(64)],
    ['65 caractères', 'd'.repeat(65)],
    ['avec saut de ligne', `${VALID.slice(0, 63)}\n`],
  ])('%s : retiré de l’URL, ni stocké ni renvoyé', (_label, token) => {
    window.history.replaceState({}, '', `/?token=${encodeURIComponent(token)}&autre=1`);
    expect(captureInviteFromUrl()).toBeNull();
    expect(window.location.search).toBe('?autre=1');
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('le paramètre `invite` invalide est traité de la même façon', () => {
    window.history.replaceState({}, '', '/?invite=../../x');
    expect(captureInviteFromUrl()).toBeNull();
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('un jeton hexadécimal de 64 caractères est accepté', () => {
    window.history.replaceState({}, '', `/?token=${VALID}`);
    expect(captureInviteFromUrl()).toBe(VALID);
  });

  it('une entrée en attente au format invalide est supprimée à la lecture', () => {
    sessionStorage.setItem(
      PENDING_INVITE_KEY,
      JSON.stringify({ token: '../../auth/logout', expiresAt: Date.now() + 60_000 }),
    );
    expect(readPendingInvite()).toBeNull();
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });
});
