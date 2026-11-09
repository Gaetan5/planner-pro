/** Types MIME autorisés pour une pièce jointe encodée en URL `data:` (S20). */
export const ATTACHMENT_DATA_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
];

const DATA_URL = new RegExp(
  `^data:(${ATTACHMENT_DATA_MIME_TYPES.map((m) => m.replace('/', '\\/')).join('|')});base64,[A-Za-z0-9+/]+={0,2}$`,
);

const MAX_HTTPS_URL_LENGTH = 2048;

/**
 * Vrai pour une URL `https:` (stockage objet, P5) ou une URL `data:` base64 d'un type de la liste
 * blanche. `javascript:`, `vbscript:`, `http:`, `data:text/html` et `data:image/svg+xml` sont refusés.
 */
export function isSafeAttachmentUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('data:')) return DATA_URL.test(value);
  if (value.length > MAX_HTTPS_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
