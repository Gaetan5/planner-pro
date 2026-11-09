/** Types MIME admis dans une URL `data:` de pièce jointe (aligné sur le serveur, S20). */
const DATA_URL_PATTERN =
  /^data:(image\/(png|jpeg|gif|webp)|application\/pdf);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Valeur sûre pour un `href` alimenté par des données : `https:` ou `data:` d'un type admis.
 * Toute autre valeur (`javascript:`, `http:`, `data:text/html`, texte quelconque) donne
 * `undefined`, donc un lien sans destination. React 18 n'interdit pas `javascript:` (S20).
 */
export function safeHref(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  if (url.startsWith('data:')) return DATA_URL_PATTERN.test(url) ? url : undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? url : undefined;
  } catch {
    return undefined;
  }
}
