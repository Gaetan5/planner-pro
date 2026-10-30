/**
 * Substitut en mémoire de RedisService pour les tests (sans expiration réelle).
 */
export class FakeRedisService {
  readonly store = new Map<string, string>();
  /** 'reject' : chaque commande échoue ; 'hang' : chaque commande reste sans réponse. */
  mode: 'ok' | 'reject' | 'hang' = 'ok';

  private async availability(): Promise<void> {
    if (this.mode === 'reject') throw new Error('Connection is closed.');
    if (this.mode === 'hang') await new Promise<never>(() => undefined);
  }

  async get(key: string): Promise<string | null> {
    await this.availability();
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.availability();
    this.store.set(key, value);
  }

  async del(key: string): Promise<number> {
    await this.availability();
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
