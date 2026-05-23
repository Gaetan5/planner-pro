import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;

  onModuleInit() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    this.redisClient = new Redis({
      host,
      port,
      maxRetriesPerRequest: null,
    });

    this.redisClient.on('connect', () => {
      console.log('Connecté au serveur Redis avec succès.');
    });

    this.redisClient.on('error', (err) => {
      console.error('Erreur Redis :', err);
    });
  }

  onModuleDestroy() {
    this.redisClient.disconnect();
  }

  /**
   * Récupère une valeur du cache.
   */
  async get(key: string): Promise<string | null> {
    return this.redisClient.get(key);
  }

  /**
   * Écrit une valeur dans le cache avec un temps de vie (TTL) en secondes.
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redisClient.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redisClient.set(key, value);
    }
  }

  /**
   * Supprime une clé du cache.
   */
  async del(key: string): Promise<void> {
    await this.redisClient.del(key);
  }
}
