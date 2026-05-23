import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

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
