import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { originCheckMiddleware } from './auth/origin-guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
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
