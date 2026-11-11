/**
 * Substitut en mémoire de RedisService pour les tests (sans expiration réelle).
 */
export class FakeRedisService {
  readonly store = new Map<string, string>();
  /** TTL (en secondes) demandés à chaque écriture : permet de vérifier les caches bornés. */
  readonly ttls: Array<{ key: string; ttl?: number }> = [];
  private readonly expiries = new Map<string, number>();
  /**
   * 'reject' : chaque commande échoue ; 'hang' : chaque commande reste sans réponse ;
   * 'write-then-mute' : `setIfAbsent` écrit puis ne répond jamais (réponse perdue), le reste fonctionne.
   */
  mode: 'ok' | 'reject' | 'hang' | 'write-then-mute' = 'ok';
  /** Clés dont la suppression a été demandée (même si la commande n'a pas abouti). */
  readonly delRequests: string[] = [];

  private async availability(): Promise<void> {
    if (this.mode === 'reject') throw new Error('Connection is closed.');
    if (this.mode === 'hang') await new Promise<never>(() => undefined);
  }

  /** Lecture synchrone avec expiration (base de `get` et des incréments atomiques). */
  private readNow(key: string): string | null {
    const expiry = this.expiries.get(key);
    if (expiry !== undefined && Date.now() >= expiry) {
      this.store.delete(key);
      this.expiries.delete(key);
    }
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  async get(key: string): Promise<string | null> {
    await this.availability();
    const expiry = this.expiries.get(key);
    if (expiry !== undefined && Date.now() >= expiry) {
      this.store.delete(key);
      this.expiries.delete(key);
    }
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.availability();
    this.store.set(key, value);
    this.ttls.push({ key, ttl: ttlSeconds });
    if (ttlSeconds) this.expiries.set(key, Date.now() + ttlSeconds * 1000);
    else this.expiries.delete(key);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if ((await this.get(key)) !== null) return false;
    await this.set(key, value, ttlSeconds);
    if (this.mode === 'write-then-mute') await new Promise<never>(() => undefined);
    return true;
  }

  async del(key: string): Promise<number> {
    this.delRequests.push(key);
    await this.availability();
    this.expiries.delete(key);
    return this.store.delete(key) ? 1 : 0;
  }

  async getAndDelete(key: string): Promise<string | null> {
    const value = await this.get(key);
    await this.del(key);
    return value;
  }

  /** Comme `INCR` + `EXPIRE ... NX` : le TTL n'est posé qu'à la création de la clé. */
  async incrementWithTtl(key: string, ttlSeconds?: number): Promise<number> {
    await this.availability();
    // Lecture et écriture sans `await` entre les deux : atomique comme Redis (r44-m2)
    const current = this.readNow(key);
    const next = Number(current ?? '0') + 1;
    this.store.set(key, String(next));
    if (current === null && ttlSeconds) this.expiries.set(key, Date.now() + ttlSeconds * 1000);
    return next;
  }

  /** Comme le script Lua de `RedisService.incrementWindow` : fenêtre fixe en millisecondes. */
  async incrementWindow(
    key: string,
    ttlMilliseconds: number,
  ): Promise<{ hits: number; ttlMilliseconds: number }> {
    await this.availability();
    let current = this.readNow(key);
    if (current === null) this.expiries.set(key, Date.now() + ttlMilliseconds);
    current = String(Number(current ?? '0') + 1);
    this.store.set(key, current);
    return {
      hits: Number(current),
      ttlMilliseconds: (this.expiries.get(key) ?? Date.now()) - Date.now(),
    };
  }

  /** Avance l'horloge des expirations (tests de fenêtre) sans attendre. */
  advance(milliseconds: number): void {
    for (const [key, at] of this.expiries) this.expiries.set(key, at - milliseconds);
  }

  async ping(): Promise<string> {
    return 'PONG';
  }
}
