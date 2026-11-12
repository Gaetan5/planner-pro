import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { originCheckMiddleware } from '../auth/origin-guard';
import { AppValidationPipe } from './app-validation.pipe';
import { registerBodyParsers } from './body-parsers';
import { noStoreMiddleware } from './no-store.middleware';
import { configureTrustProxy } from './trust-proxy';

/**
 * Câblage HTTP de l'API (proxy de confiance, analyseurs de corps, Helmet, no-store, pipe de
 * validation, cookies, anti-CSRF, CORS), partagé par `main.ts` et par le banc e2e : les tests
 * d'en-têtes et de limites exercent ainsi le code réel (A9-b0). L'ordre compte : proxy de confiance
 * avant les analyseurs (le pré-contrôle du webhook lit `req.ip`), analyseurs avant Helmet.
 */
export function configureHttpApp(
  app: NestExpressApplication,
  env: NodeJS.ProcessEnv = process.env,
): void {
  // IP réelle du client derrière le reverse proxy (limitation de débit, journaux) : S24
  configureTrustProxy(app, env);
  // Limites de corps explicites (1 Mo, plafond dédié aux livraisons GitHub) et application/scim+json
  // pour les IdP SCIM (RFC 7644 §3.1) : voir common/body-parsers.ts (S23)
  registerBodyParsers(app);
  app.use(helmet());
  // Réponses sensibles jamais mises en cache (O16)
  app.use(noStoreMiddleware());
  app.useGlobalPipes(new AppValidationPipe());
  app.use(cookieParser());
  // Anti-CSRF des sites voisins : Origin/Referer obligatoire pour les requêtes à cookie (S29)
  app.use(originCheckMiddleware());
  const allowedOrigins = (env.CORS_ORIGINS || '').split(',').filter(Boolean);

  if (env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    throw new Error("La variable d'environnement CORS_ORIGINS doit être définie en production.");
  }

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : 'http://localhost:3000',
    credentials: true,
  });
}
