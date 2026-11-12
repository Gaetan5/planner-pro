/** Délai maximal accordé à un `quit()` Redis à l'arrêt (O23). */
export const REDIS_QUIT_TIMEOUT_MS = 2000;

interface QuittableClient {
  quit(): Promise<unknown>;
  disconnect(): unknown;
}

/**
 * Fermeture ordonnée d'un client Redis, bornée (O23) : `quit()` attend les réponses en attente,
 * mais avec `maxRetriesPerRequest: null` (ioredis) ou une reconnexion en cours, il peut attendre
 * indéfiniment pendant une panne de Redis, et `docker stop` finirait en SIGKILL. Passé le délai,
 * ou en cas d'erreur, la connexion est coupée de force. Ne lève jamais d'exception.
 */
export async function quitWithin(
  client: QuittableClient,
  timeoutMs: number = REDIS_QUIT_TIMEOUT_MS,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      // `resolve().then` : un `quit()` qui lève de façon synchrone est traité comme un échec
      Promise.resolve()
        .then(() => client.quit())
        .then(
          () => 'closed' as const,
          () => 'failed' as const,
        ),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
    if (outcome === 'closed') return;
  } finally {
    if (timer) clearTimeout(timer);
  }
  try {
    await Promise.resolve().then(() => client.disconnect());
  } catch {
    /* rien à libérer de plus */
  }
}
