import { INestApplication, LoggerService } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { configureHttpApp } from '../../../src/common/configure-http-app';

/**
 * Environnement minimal d'une exécution e2e (A9). Les valeurs viennent de la CI ou de l'appel
 * local ; aucun secret réel n'est lu ici.
 */
export function prepareE2eEnvironment(): void {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      'E2E_DATABASE_URL est obligatoire pour la suite e2e (base MySQL jetable, voir docs/security/ci.md).',
    );
  }
  // Garde-fou : la suite crée et supprime des comptes. Elle refuse toute base qui ne porte pas
  // explicitement un nom de test (jamais une base de développement ou de production).
  const database = new URL(url).pathname.replace(/^\//, '');
  if (!/(_test|_e2e)$/.test(database)) {
    throw new Error(`Base e2e refusée : « ${database} » doit se terminer par _test ou _e2e.`);
  }
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ??= 'e2e-jwt-secret-key-32-chars-minimum!';
  process.env.ENCRYPTION_KEY ??= 'abcdefghijklmnopqrstuvwxyz123456';
}

/**
 * Démarre l'application complète (AppModule : vraie base MySQL, vrai Redis, gardes globaux) sur un
 * port éphémère. La configuration HTTP est celle de `main.ts` (`configureHttpApp`, Helmet et CORS compris,
 * A9-b0) avec un proxy de confiance : chaque exécution choisit son adresse `X-Forwarded-For`, donc
 * son propre compteur de limitation de débit (S24). `logger` : journal Nest à capturer (table des
 * routes) ; par défaut, aucun journal.
 */
export async function startE2eApp(
  options: { trustProxyHops?: string; logger?: LoggerService } = {},
): Promise<{ app: INestApplication; baseUrl: string }> {
  prepareE2eEnvironment();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: options.logger ?? false,
    rawBody: true,
  });
  configureHttpApp(app, { ...process.env, TRUST_PROXY_HOPS: options.trustProxyHops ?? '1' });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
