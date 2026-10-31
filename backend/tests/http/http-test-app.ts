import { INestApplication, ModuleMetadata, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { originCheckMiddleware } from '../../src/auth/origin-guard';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Démarre une application Nest réelle (routage, guards, pipes) sur un port éphémère,
 * sans base de données, pour les tests HTTP d'abus.
 */
export async function startHttpTestApp(
  metadata: ModuleMetadata,
): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule(metadata).compile();
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
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.use(originCheckMiddleware());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
