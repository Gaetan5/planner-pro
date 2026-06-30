import { hashPassword, verifyPassword } from '../../src/auth/encryption.util';
import { pbkdf2Sync } from 'crypto';

describe('Password Hashing (Argon2id & Legacy PBKDF2)', () => {
  it('devrait hacher avec Argon2id et vérifier correctement', async () => {
    const password = 'mon-super-mot-de-passe';
    const hash = await hashPassword(password);
    
    expect(hash).toMatch(/^\$argon2/); // Vérifie le format Argon2
    
    const { isValid, needsMigration } = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
    expect(needsMigration).toBe(false);
  });

  it('devrait refuser un mot de passe incorrect avec Argon2id', async () => {
    const password = 'mon-super-mot-de-passe';
    const hash = await hashPassword(password);
    
    const { isValid } = await verifyPassword('mauvais-mot-de-passe', hash);
    expect(isValid).toBe(false);
  });

  it('devrait vérifier correctement un hash legacy PBKDF2', async () => {
    // Création d'un hash PBKDF2 manuel pour le test
    const salt = '1234567890123456';
    const password = 'mot-de-passe-legacy';
    const hash = pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    const legacyHash = `${salt}:${hash}`;
    
    const { isValid, needsMigration } = await verifyPassword(password, legacyHash);
    expect(isValid).toBe(true);
    expect(needsMigration).toBe(true);
  });

  it('devrait refuser un mot de passe incorrect pour un hash legacy', async () => {
    const salt = '1234567890123456';
    const password = 'mot-de-passe-legacy';
    const hash = pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    const legacyHash = `${salt}:${hash}`;
    
    const { isValid } = await verifyPassword('mauvais-mot-de-passe', legacyHash);
    expect(isValid).toBe(false);
  });
});
