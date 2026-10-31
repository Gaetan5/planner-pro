/**
 * Substitut en mémoire de RedisService pour les tests (sans expiration réelle).
 */
export class FakeRedisService {
  readonly store = new Map<string, string>();
  /** TTL (en secondes) demandés à chaque écriture : permet de vérifier les caches bornés. */
  readonly ttls: Array<{ key: string; ttl?: number }> = [];
  private readonly expiries = new Map<string, number>();
  /** 'reject' : chaque commande échoue ; 'hang' : chaque commande reste sans réponse. */
  mode: 'ok' | 'reject' | 'hang' = 'ok';

  private async availability(): Promise<void> {
    if (this.mode === 'reject') throw new Error('Connection is closed.');
    if (this.mode === 'hang') await new Promise<never>(() => undefined);
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

  async del(key: string): Promise<number> {
    await this.availability();
    this.expiries.delete(key);
    return this.store.delete(key) ? 1 : 0;
  }

  async incrementWithTtl(key: string): Promise<number> {
    await this.availability();
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return next;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }
}
