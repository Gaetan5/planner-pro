import { encrypt, decrypt } from '../../src/auth/encryption.util';

describe('Encryption Utility (AES-256-GCM)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('devrait chiffrer et déchiffrer correctement un texte', () => {
    process.env.ENCRYPTION_KEY = 'super-secret-key-32-bytes-long!!'; // 32 octets
    const plainText = 'mon_secret_github_token';
    const cipherText = encrypt(plainText);

    expect(cipherText).toBeDefined();
    expect(cipherText).toContain(':');

    const parts = cipherText.split(':');
    expect(parts.length).toBe(3); // iv, tag, encrypted

    const decrypted = decrypt(cipherText);
    expect(decrypted).toBe(plainText);
  });

  it('devrait lever une erreur si la clé de chiffrement est absente', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow(
      "La variable d'environnement ENCRYPTION_KEY est obligatoire mais absente.",
    );
  });

  it('devrait lever une erreur si la clé de chiffrement ne fait pas 32 octets', () => {
    process.env.ENCRYPTION_KEY = 'too-short'; // 9 octets
    expect(() => encrypt('test')).toThrow('La clé ENCRYPTION_KEY doit faire exactement 32 octets');
  });
});
