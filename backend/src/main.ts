import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureHttpApp } from './common/configure-http-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // HMAC du webhook GitHub calculé sur le corps exact reçu (S21)
  });
  // Proxy de confiance, corps, Helmet, no-store, validation, cookies, CSRF, CORS : voir common/configure-http-app.ts
  configureHttpApp(app);
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Backend NestJS running on: ${await app.getUrl()}`);
}
bootstrap();
