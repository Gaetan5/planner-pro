import * as crypto from 'crypto';

// Table de caractères Base32 (RFC 4648)
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode un buffer en chaîne Base32 (RFC 4648 sans padding)
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Décode une chaîne Base32 en Buffer
 */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_CHARS.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error(`Caractère Base32 invalide : ${cleaned[i]}`);
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Génère une clé secrète aléatoire de 20 octets (160 bits) encodée en Base32
 */
export function generateTotpSecret(): string {
  const randomBytes = crypto.randomBytes(20);
  return base32Encode(randomBytes);
}

/**
 * Calcule le code TOTP à 6 chiffres pour un secret et un timestamp donné (RFC 6238)
 */
export function generateTotpCode(
  secretBase32: string,
  timestampMs = Date.now(),
  stepSeconds = 30,
): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);

  // Buffer de 8 octets en big-endian
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key as unknown as crypto.BinaryLike);
  hmac.update(counterBuffer as unknown as crypto.BinaryLike);
  const digest = hmac.digest();

  // Dynamic truncation (RFC 4226)
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

/**
 * Vérifie un code TOTP avec tolérance d'horloge (fenêtre de ±1 step = ±30s)
 */
export function verifyTotpCode(
  secretBase32: string,
  token: string,
  window = 1,
  timestampMs = Date.now(),
  stepSeconds = 30,
): boolean {
  if (!secretBase32 || !token || token.length !== 6) {
    return false;
  }

  const cleanToken = token.trim();
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const testTime = timestampMs + errorWindow * stepSeconds * 1000;
    const expected = generateTotpCode(secretBase32, testTime, stepSeconds);
    if (
      crypto.timingSafeEqual(
        Buffer.from(cleanToken) as unknown as NodeJS.ArrayBufferView,
        Buffer.from(expected) as unknown as NodeJS.ArrayBufferView,
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Génère l'URI standard otpauth:// pour les applications Authenticator (Google Authenticator, Microsoft Authenticator)
 */
export function getTotpAuthUri(
  email: string,
  secretBase32: string,
  issuer = 'Planner-Pro',
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secretBase32}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}
