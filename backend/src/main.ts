import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppValidationPipe } from './common/app-validation.pipe';
import { originCheckMiddleware } from './auth/origin-guard';
import { noStoreMiddleware } from './common/no-store.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // HMAC du webhook GitHub calculé sur le corps exact reçu (S21)
  });
  // Les IdP SCIM envoient application/scim+json (RFC 7644 §3.1) : corps JSON à analyser aussi
  app.useBodyParser('json', { type: ['application/json', 'application/scim+json'] });
  app.use(helmet());
  // Réponses sensibles jamais mises en cache (O16)
  app.use(noStoreMiddleware());
  app.useGlobalPipes(new AppValidationPipe());
  app.use(cookieParser());
  // Anti-CSRF des sites voisins : Origin/Referer obligatoire pour les requêtes à cookie (S29)
  app.use(originCheckMiddleware());
  const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);

  if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    throw new Error("La variable d'environnement CORS_ORIGINS doit être définie en production.");
  }

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : 'http://localhost:3000',
    credentials: true,
  });
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Backend NestJS running on: ${await app.getUrl()}`);
}
bootstrap();
