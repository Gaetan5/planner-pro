import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { AppValidationPipe } from '../../src/common/app-validation.pipe';
import { NestExpressApplication } from '@nestjs/platform-express';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { originCheckMiddleware } from '../../src/auth/origin-guard';
import { noStoreMiddleware } from '../../src/common/no-store.middleware';
import { FeatureFlagGuard } from '../../src/config/feature-flag.guard';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Démarre une application Nest réelle (routage, guards, pipes) sur un port éphémère,
 * sans base de données, pour les tests HTTP d'abus.
 */
export async function startHttpTestApp(
  metadata: ModuleMetadata,
): Promise<{ app: INestApplication; baseUrl: string }> {
  // Comme AppModule (A1) : drapeau de fonctionnalité puis authentification par défaut, dès que
  // le test fournit JwtAuthGuard (donc SessionService).
  const providers = metadata.providers ?? [];
  const withAuth = providers.includes(JwtAuthGuard);
  const moduleRef = await Test.createTestingModule({
    ...metadata,
    providers: withAuth
      ? [
          ...providers,
          { provide: APP_GUARD, useClass: FeatureFlagGuard },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
        ]
      : providers,
  }).compile();
  // Garde-fou : un test HTTP ne doit jamais ouvrir une connexion à une vraie base (une base de
  // développement locale peut écouter sur 3306). Importer PrismaModule/AuthModule/AppModule ici
  // instancierait le vrai PrismaService.
  let prismaProvider: unknown;
  try {
    prismaProvider = moduleRef.get(PrismaService, { strict: false });
  } catch {
    prismaProvider = undefined;
  }
  if (prismaProvider instanceof PrismaService) {
    throw new Error(
      'Test HTTP interdit : un vrai PrismaService est instancié. Fournir un faux Prisma (tests/http/fake-prisma.ts).',
    );
  }
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
    rawBody: true, // comme main.ts (S21)
  });
  app.useBodyParser('json', { type: ['application/json', 'application/scim+json'] });
  app.use(noStoreMiddleware()); // comme main.ts (O16)
  app.use(cookieParser());
  app.use(originCheckMiddleware());
  app.useGlobalPipes(new AppValidationPipe());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
