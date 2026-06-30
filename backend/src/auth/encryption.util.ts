import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import * as argon2 from 'argon2';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Récupère la clé de chiffrement et s'assure qu'elle est valide (32 octets).
 * Lève une erreur fatale au démarrage si absente ou invalide (Fail-Fast).
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('La variable d\'environnement ENCRYPTION_KEY est obligatoire mais absente.');
  }

  const keyBuffer = Buffer.from(key, 'utf8');
  if (keyBuffer.length !== 32) {
    throw new Error(`La clé ENCRYPTION_KEY doit faire exactement 32 octets (actuellement : ${keyBuffer.length} octets).`);
  }

  return keyBuffer;
}

/**
 * Chiffre un texte avec l'algorithme AES-256-GCM.
 * Renvoie une chaîne au format "iv:tag:encrypted" en hexadécimal.
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Déchiffre un texte chiffré généré par encrypt().
 */
export function decrypt(cipherText: string): string {
  const key = getEncryptionKey();
  const parts = cipherText.split(':');
  
  if (parts.length !== 3) {
    throw new Error('Format de texte chiffré invalide (doit être "iv:tag:encrypted").');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Hache un mot de passe avec Argon2id.
 */
export async function hashPassword(password: string): Promise<string> {
  return await argon2.hash(password, { type: argon2.argon2id });
}

/**
 * Vérifie si un mot de passe correspond à un hachage stocké (Argon2 ou PBKDF2 legacy).
 * Renvoie un objet indiquant si le mot de passe est valide et s'il nécessite une migration.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<{ isValid: boolean; needsMigration: boolean }> {
  // Détection du format : Argon2 commence par $argon2
  if (storedHash.startsWith('$argon2')) {
    const isValid = await argon2.verify(storedHash, password);
    return { isValid, needsMigration: false };
  }

  // Legacy PBKDF2 support
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return { isValid: false, needsMigration: false };
  }
  const [salt, hash] = parts;
  const verifyHash = pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  
  return { isValid: hash === verifyHash, needsMigration: true };
}

