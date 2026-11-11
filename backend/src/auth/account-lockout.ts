import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

/** Échecs par compte et par minute au-delà desquels toute tentative est refusée en 429 (S24). */
export const ACCOUNT_FAILURES_PER_MINUTE = 5;
/** Échecs cumulés (fenêtre de 24 h) déclenchant un verrouillage, puis tous les multiples de ce seuil. */
export const LOCKOUT_THRESHOLD = 10;
/** Durée du premier verrouillage ; elle double à chaque palier, plafonnée à 24 h. */
export const LOCKOUT_BASE_SECONDS = 15 * 60;
export const LOCKOUT_MAX_SECONDS = 24 * 60 * 60;
const MINUTE_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * 60;
/** Délai maximal d'une commande Redis : au-delà, repli sur le compteur local de l'instance. */
export const LOCKOUT_REDIS_TIMEOUT_MS = 300;
/** Après une erreur ou un délai dépassé, Redis est ignoré pendant cette durée (la panne ne coûte qu'un délai par épisode). */
export const LOCKOUT_DEGRADED_MS = 5_000;
/** Taille maximale du compteur local de repli (une adresse aléatoire par requête ne le fait pas grossir sans fin). */
const MEMORY_MAX_ENTRIES = 10_000;

/** Sous-ensemble de `RedisService` utilisé (les clés sont à durée de vie bornée). */
export interface LockoutStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<number>;
  incrementWithTtl(key: string, ttlSeconds: number): Promise<number>;
}

/** Durée du verrouillage après `failures` échecs cumulés (multiple de `LOCKOUT_THRESHOLD`). */
export function lockoutSeconds(failures: number): number {
  const step = Math.max(1, Math.floor(failures / LOCKOUT_THRESHOLD));
  return Math.min(LOCKOUT_BASE_SECONDS * 2 ** (step - 1), LOCKOUT_MAX_SECONDS);
}

/**
 * Limitation des échecs d'authentification PAR COMPTE, en plus de la limite par adresse IP (S24) :
 * une adresse IP change à volonté (botnet, proxys), l'identité visée non.
 *  - plus de 5 tentatives en une minute sur un même compte (réservées avant vérification) : 429 (toutes adresses confondues) ;
 *  - 10 échecs cumulés sur 24 h, puis 20, 30... : verrouillage de 15 min, 30 min, 1 h... (24 h au plus).
 * La clé est le SHA-256 de l'identité (adresse e-mail normalisée, ou identifiant utilisateur pour le
 * MFA), appliquée de la même façon aux comptes inexistants : la réponse ne révèle pas l'existence
 * d'un compte. Le compte visé peut donc être ralenti par un tiers qui échoue exprès (compromis
 * assumé de tout verrouillage par compte ; la limite par IP et le délai court le bornent).
 * Redis lent ou indisponible : compteur local à l'instance (fail-open), jamais une erreur 5xx.
 */
export class AccountLockout {
  private readonly logger = new Logger(AccountLockout.name);
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();
  private lastWarning = 0;
  private degradedUntil = 0;

  constructor(
    private readonly store: LockoutStore,
    private readonly scope: 'login' | 'mfa',
    private readonly timeoutMs: number = LOCKOUT_REDIS_TIMEOUT_MS,
  ) {}

  private key(subject: string, part: 'minute' | 'total' | 'lock'): string {
    const hash = createHash('sha256').update(subject).digest('hex');
    return `lockout:${this.scope}:${hash}:${part}`;
  }

  /**
   * Réserve une tentative puis décide (atomique, r44-m2) : l'incrément de la minute précède la
   * comparaison, donc N requêtes simultanées ne passent pas toutes avant qu'une seule ait échoué.
   * Lève 429 si le compte est verrouillé ou si la minute compte déjà plus de 5 tentatives.
   * Une tentative réussie remet les compteurs à zéro (`reset`).
   */
  async assertAllowed(subject: string): Promise<void> {
    const locked = await this.read(this.key(subject, 'lock'));
    if (locked !== null) {
      throw new HttpException(
        'Trop de tentatives échouées : compte temporairement verrouillé, réessayez plus tard.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const attempts = await this.increment(this.key(subject, 'minute'), MINUTE_SECONDS);
    if (attempts > ACCOUNT_FAILURES_PER_MINUTE) {
      throw new HttpException(
        'Trop de tentatives échouées : réessayez dans une minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Enregistre un échec (compteur de 24 h) ; au seuil cumulé, pose le verrou (durée progressive). */
  async recordFailure(subject: string): Promise<void> {
    const total = await this.increment(this.key(subject, 'total'), DAY_SECONDS);
    if (total >= LOCKOUT_THRESHOLD && total % LOCKOUT_THRESHOLD === 0) {
      const seconds = lockoutSeconds(total);
      await this.write(this.key(subject, 'lock'), '1', seconds);
      // Seule l'empreinte de l'identité est journalisée, jamais l'adresse ni l'identifiant
      const fingerprint = createHash('sha256').update(subject).digest('hex').slice(0, 12);
      this.logger.warn(
        `Verrouillage de compte posé (${this.scope}) : empreinte ${fingerprint}, ${total} échecs cumulés, ${seconds} s.`,
      );
    }
  }

  /** Succès (mot de passe ou code correct) : les compteurs d'échecs repartent de zéro. */
  async reset(subject: string): Promise<void> {
    await Promise.all([
      this.remove(this.key(subject, 'minute')),
      this.remove(this.key(subject, 'total')),
    ]);
  }

  // ─── Accès Redis avec repli mémoire ───────────────────────────────────────────────────────

  private async guarded<T>(redisOp: () => Promise<T>, memoryOp: () => T): Promise<T> {
    if (Date.now() < this.degradedUntil) return memoryOp();
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Délai Redis dépassé')), this.timeoutMs);
      });
      return await Promise.race([redisOp(), timeout]);
    } catch (error) {
      this.degradedUntil = Date.now() + LOCKOUT_DEGRADED_MS;
      this.warn(error);
      return memoryOp();
    } finally {
      clearTimeout(timer);
    }
  }

  private read(key: string): Promise<string | null> {
    return this.guarded(
      () => this.store.get(key),
      () => this.memoryGet(key),
    );
  }

  private write(key: string, value: string, ttlSeconds: number): Promise<void> {
    return this.guarded(
      () => this.store.set(key, value, ttlSeconds),
      () => this.memorySet(key, value, ttlSeconds),
    );
  }

  private async remove(key: string): Promise<void> {
    await this.guarded(
      async () => void (await this.store.del(key)),
      () => void this.memory.delete(key),
    );
  }

  private increment(key: string, ttlSeconds: number): Promise<number> {
    return this.guarded(
      () => this.store.incrementWithTtl(key, ttlSeconds),
      () => {
        const next = Number(this.memoryGet(key) ?? '0') + 1;
        const existing = this.memory.get(key);
        this.memorySet(
          key,
          String(next),
          existing ? Math.ceil((existing.expiresAt - Date.now()) / 1000) : ttlSeconds,
        );
        return next;
      },
    );
  }

  private memoryGet(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  private memorySet(key: string, value: string, ttlSeconds: number): void {
    if (this.memory.size >= MEMORY_MAX_ENTRIES && !this.memory.has(key)) {
      // Purge des entrées expirées, puis de la plus ancienne si la table est toujours pleine
      const now = Date.now();
      for (const [k, v] of this.memory) if (v.expiresAt <= now) this.memory.delete(k);
      if (this.memory.size >= MEMORY_MAX_ENTRIES) {
        const oldest = this.memory.keys().next().value;
        if (oldest !== undefined) this.memory.delete(oldest);
      }
    }
    this.memory.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000 });
  }

  private warn(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarning < 60_000) return;
    this.lastWarning = now;
    this.logger.warn(
      `Redis indisponible pour le verrouillage de compte (${this.scope}), compteur local utilisé : ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
