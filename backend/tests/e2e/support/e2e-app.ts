import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../../../src/app.module';
import { originCheckMiddleware } from '../../../src/auth/origin-guard';
import { AppValidationPipe } from '../../../src/common/app-validation.pipe';
import { registerBodyParsers } from '../../../src/common/body-parsers';
import { noStoreMiddleware } from '../../../src/common/no-store.middleware';
import { configureTrustProxy } from '../../../src/common/trust-proxy';

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
 * port éphémère. La configuration HTTP reproduit `main.ts` (hors helmet et CORS, sans effet sur les
 * contrôles testés) avec un proxy de confiance : chaque exécution choisit son adresse
 * `X-Forwarded-For`, donc son propre compteur de limitation de débit (S24).
 */
export async function startE2eApp(
  options: { trustProxyHops?: string } = {},
): Promise<{ app: INestApplication; baseUrl: string }> {
  prepareE2eEnvironment();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
    rawBody: true,
  });
  configureTrustProxy(app, { TRUST_PROXY_HOPS: options.trustProxyHops ?? '1' });
  registerBodyParsers(app);
  app.use(noStoreMiddleware());
  app.useGlobalPipes(new AppValidationPipe());
  app.use(cookieParser());
  app.use(originCheckMiddleware());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
