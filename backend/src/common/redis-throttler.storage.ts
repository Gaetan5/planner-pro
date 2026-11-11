import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

/** Compteur à fenêtre fixe partagé (Redis) : sous-ensemble de `RedisService` utilisé ici. */
export interface WindowCounter {
  incrementWindow(
    key: string,
    ttlMilliseconds: number,
  ): Promise<{ hits: number; ttlMilliseconds: number }>;
}

/** Délai maximal d'une commande Redis de limitation : au-delà, repli sur la mémoire locale. */
export const THROTTLER_REDIS_TIMEOUT_MS = 500;
/** Après une erreur ou un délai dépassé, Redis est ignoré pendant cette durée (r44-a2). */
export const THROTTLER_DEGRADED_MS = 5_000;
const KEY_PREFIX = 'throttle:';
/** Une alerte au plus par minute pendant une panne Redis (pas d'inondation des journaux). */
const WARN_INTERVAL_MS = 60_000;

/**
 * Stockage du limiteur de débit dans Redis (S24) : les compteurs sont communs à toutes les
 * instances du backend et survivent à un redémarrage. En cas d'erreur ou de lenteur de Redis, le
 * limiteur retombe sur un compteur mémoire local (fail-open par instance) plutôt que de renvoyer
 * 500 sur toutes les routes : la limite reste appliquée instance par instance.
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarning = 0;
  private degradedUntil = 0;

  constructor(
    private readonly redis: WindowCounter,
    private readonly fallback: ThrottlerStorage &
      Partial<OnApplicationShutdown> = new ThrottlerStorageService(),
    private readonly timeoutMs: number = THROTTLER_REDIS_TIMEOUT_MS,
  ) {}

  async increment(
    key: string,
    ttl: number,
  ): Promise<Awaited<ReturnType<ThrottlerStorage['increment']>>> {
    // Disjoncteur : pendant une panne, un seul délai par épisode, pas 500 ms par requête
    if (Date.now() < this.degradedUntil) return this.fallback.increment(key, ttl);
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Délai Redis dépassé')), this.timeoutMs);
      });
      const { hits, ttlMilliseconds } = await Promise.race([
        this.redis.incrementWindow(KEY_PREFIX + key, ttl),
        timeout,
      ]);
      return { totalHits: hits, timeToExpire: Math.max(1, Math.ceil(ttlMilliseconds / 1000)) };
    } catch (error) {
      this.degradedUntil = Date.now() + THROTTLER_DEGRADED_MS;
      this.warn(error);
      return this.fallback.increment(key, ttl);
    } finally {
      clearTimeout(timer);
    }
  }

  onApplicationShutdown(signal?: string): void {
    this.fallback.onApplicationShutdown?.(signal);
  }

  private warn(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarning < WARN_INTERVAL_MS) return;
    this.lastWarning = now;
    this.logger.warn(
      `Redis indisponible pour la limitation de débit, compteur local utilisé : ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
