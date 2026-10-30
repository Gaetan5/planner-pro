import { INestApplication, ModuleMetadata, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';

/**
 * Démarre une application Nest réelle (routage, guards, pipes) sur un port éphémère,
 * sans base de données, pour les tests HTTP d'abus.
 */
export async function startHttpTestApp(
  metadata: ModuleMetadata,
): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule(metadata).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
