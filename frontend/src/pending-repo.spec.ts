import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PENDING_REPO_KEY,
  PENDING_REPO_TTL_MS,
  clearPendingRepo,
  isProjectId,
  readPendingRepo,
  savePendingRepo,
} from './pending-repo';

const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';

describe('dépôt en attente (P9-R)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('enregistre le projet en sessionStorage, avec une échéance de 15 minutes, jamais en localStorage', () => {
    expect(PENDING_REPO_TTL_MS).toBe(15 * 60 * 1000);
    expect(savePendingRepo(ID, 1000)).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(PENDING_REPO_KEY) as string)).toEqual({
      projectId: ID,
      expiresAt: 1000 + PENDING_REPO_TTL_MS,
    });
    expect(localStorage.length).toBe(0);
    expect(readPendingRepo(1000 + PENDING_REPO_TTL_MS - 1)).toBe(ID);
  });

  it('entrée expirée : ignorée et supprimée', () => {
    savePendingRepo(ID, 1000);
    expect(readPendingRepo(1000 + PENDING_REPO_TTL_MS)).toBeNull();
    expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
  });

  it.each([
    ['traversée de chemin', '../../auth/sessions'],
    ['segment encodé', '3f2b8c1e%2F..%2Fx'],
    ['identifiant court', 'project-1'],
    ['chaîne vide', ''],
    ['objet d’opérateurs', { $ne: '' }],
    ['nombre', 42],
    ['null', null],
  ])('identifiant lu invalide (%s) : ignoré et supprimé', (_label, projectId) => {
    sessionStorage.setItem(
      PENDING_REPO_KEY,
      JSON.stringify({ projectId, expiresAt: Date.now() + 60_000 }),
    );
    expect(readPendingRepo()).toBeNull();
    expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
  });

  it.each(['pas du JSON', '{"projectId":', '[]', '"texte"'])(
    'contenu illisible %s : ignoré et supprimé',
    (raw) => {
      sessionStorage.setItem(PENDING_REPO_KEY, raw);
      expect(readPendingRepo()).toBeNull();
      expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
    },
  );

  it('échéance absente : ignorée', () => {
    sessionStorage.setItem(PENDING_REPO_KEY, JSON.stringify({ projectId: ID }));
    expect(readPendingRepo()).toBeNull();
  });

  it('un identifiant invalide n’est jamais enregistré', () => {
    expect(savePendingRepo('../x')).toBe(false);
    expect(sessionStorage.getItem(PENDING_REPO_KEY)).toBeNull();
  });

  it('clearPendingRepo supprime l’entrée ; absente : null', () => {
    savePendingRepo(ID);
    clearPendingRepo();
    expect(readPendingRepo()).toBeNull();
  });

  it('isProjectId : UUID uniquement', () => {
    expect(isProjectId(ID)).toBe(true);
    expect(isProjectId(ID.toUpperCase())).toBe(true);
    expect(isProjectId(`${ID}/x`)).toBe(false);
    expect(isProjectId(undefined)).toBe(false);
  });
});
