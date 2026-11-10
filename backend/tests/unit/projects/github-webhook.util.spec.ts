import { createHmac } from 'crypto';
import {
  extractTaskIdsFromText,
  generateWebhookSecret,
  verifyGitHubSignature,
} from '../../../src/projects/github-webhook.util';

const sign = (secret: string, body: string | Buffer) =>
  'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('S21 : signature du webhook GitHub', () => {
  const secret = 'a'.repeat(64);
  // JSON avec espaces et retours à la ligne : une re-sérialisation donnerait un autre HMAC
  const raw = Buffer.from('{ "ref" :  "refs/heads/main",\n  "commits": [ ] }\n');

  it('accepte la signature calculée sur le corps brut (avec espaces)', () => {
    expect(verifyGitHubSignature(secret, raw, sign(secret, raw))).toBe(true);
  });

  it('refuse la signature calculée sur le JSON re-sérialisé', () => {
    const reserialized = JSON.stringify(JSON.parse(raw.toString()));
    expect(reserialized).not.toBe(raw.toString());
    expect(verifyGitHubSignature(secret, raw, sign(secret, reserialized))).toBe(false);
  });

  it('refuse une signature calculée avec un autre secret', () => {
    expect(verifyGitHubSignature(secret, raw, sign('b'.repeat(64), raw))).toBe(false);
  });

  it('refuse un corps modifié d’un octet', () => {
    const tampered = Buffer.concat([raw, Buffer.from(' ')]);
    expect(verifyGitHubSignature(secret, tampered, sign(secret, raw))).toBe(false);
  });

  it.each([
    ['absente', undefined],
    ['vide', ''],
    ['sans préfixe', createHmac('sha256', 'a'.repeat(64)).update('x').digest('hex')],
    ['tronquée', 'sha256=abcd'],
    ['trop longue', 'sha256=' + 'a'.repeat(66)],
    ['non hexadécimale', 'sha256=' + 'z'.repeat(64)],
    ['sha1', 'sha1=' + 'a'.repeat(40)],
  ])('refuse une signature %s sans lever d’exception', (_label, signature) => {
    expect(verifyGitHubSignature(secret, raw, signature as string | undefined)).toBe(false);
  });

  it('refuse un corps brut absent ou un secret vide', () => {
    expect(verifyGitHubSignature(secret, undefined, sign(secret, raw))).toBe(false);
    expect(verifyGitHubSignature('', raw, sign('', raw))).toBe(false);
  });

  it('accepte une signature hexadécimale en majuscules (même valeur)', () => {
    const upper = 'sha256=' + sign(secret, raw).slice(7).toUpperCase();
    expect(verifyGitHubSignature(secret, raw, upper)).toBe(true);
  });
});

describe('S21 : secret généré', () => {
  it('fait 32 octets (64 caractères hexadécimaux) et diffère à chaque appel', () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateWebhookSecret()).not.toBe(a);
  });
});

describe('extractTaskIdsFromText', () => {
  const id1 = 'b406e122-37b4-4b5c-b171-d68a9fdfc418';
  const id2 = 'c1234567-89ab-cdef-0123-456789abcdef';

  it('extrait les UUID précédés d’un mot-clé de fermeture', () => {
    const text = `fixes #${id1} et closes #${id2}. UUID nu ${id1}, fix #${id1.slice(0, 10)}`;
    expect(extractTaskIdsFromText(text)).toEqual([id1, id2]);
  });

  it('est insensible à la casse et répétable (regex globale sans état partagé)', () => {
    expect(extractTaskIdsFromText(`FIXES #${id1}`)).toEqual([id1]);
    expect(extractTaskIdsFromText(`ClOsEd #${id1}`)).toEqual([id1]);
  });

  it('renvoie une liste vide pour un texte vide', () => {
    expect(extractTaskIdsFromText('')).toEqual([]);
  });
});
