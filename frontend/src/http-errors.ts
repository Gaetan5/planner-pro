/**
 * Messages d'erreur HTTP communs (r47-m2, r48-m1). Un 429 peut venir du backend (message utile en
 * français : verrouillage du compte, limiteur) ou de Nginx (corps HTML ou vide) : le message du
 * serveur est affiché quand c'est une chaîne non vide ; ce message générique ne sert qu'en repli.
 */
export const TOO_MANY_REQUESTS_MESSAGE =
  'Trop de requêtes. Patientez quelques instants avant de réessayer.';

/** Extrait le `message` d'un corps JSON Nest : chaîne non vide, ou tableau de chaînes (ValidationPipe) joint. */
export function serverMessageOf(body: unknown): string | string[] | undefined {
  if (typeof body !== 'object' || body === null || !('message' in body)) return undefined;
  const { message } = body;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((item) => typeof item === 'string')) return message;
  return undefined;
}

/** Message affiché pour une réponse en erreur : celui du serveur s'il existe, sinon le repli (message dédié pour 429). */
export function apiErrorMessage(
  status: number,
  serverMessage: string | string[] | undefined,
  fallback: string,
): string {
  const message = (Array.isArray(serverMessage) ? serverMessage.join(' ') : serverMessage)?.trim();
  if (message) return message;
  return status === 429 ? TOO_MANY_REQUESTS_MESSAGE : fallback;
}

/** Lit le corps d'une réponse en erreur (JSON Nest `{ message }`) et renvoie le message à afficher. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  const data: unknown = await res.json().catch(() => undefined);
  return apiErrorMessage(res.status, serverMessageOf(data), fallback);
}
