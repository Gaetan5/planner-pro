import { Controller, Get, INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../src/auth/jwt.guard';
import { Public } from '../../src/auth/public.decorator';
import { SessionService } from '../../src/auth/session.service';
import { TokenModule } from '../../src/auth/token.module';
import { RequireFeature } from '../../src/config/feature-flag.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { FakePrisma } from './fake-prisma';
import { FakeRedisService } from './fake-redis';
import { startHttpTestApp } from './http-test-app';

jest.setTimeout(30_000);

/** Contrôleur « oublié » : aucun décorateur d'authentification. */
@Controller('nouveau')
class NouveauController {
  @Get('secret')
  secret() {
    return { secret: true };
  }
  @Public()
  @Get('ouvert')
  ouvert() {
    return { ouvert: true };
  }
}

@RequireFeature('SSO')
@Controller('experimental')
class FlaggedController {
  @Get()
  read() {
    return { ok: true };
  }
}

/** A1 : un contrôleur sans `@UseGuards` n'est jamais public par défaut. */
describe('A1 : authentification par défaut (HTTP)', () => {
  const JWT_SECRET = 'test-secret-a1-http-0123456789abcdef0123456';
  let app: INestApplication;
  let baseUrl: string;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    delete process.env.FEATURE_SSO_ENABLED;
    ({ app, baseUrl } = await startHttpTestApp({
      imports: [JwtModule.register({ global: true, secret: JWT_SECRET }), TokenModule],
      controllers: [NouveauController, FlaggedController],
      providers: [
        JwtAuthGuard,
        SessionService,
        { provide: PrismaService, useValue: new FakePrisma() },
        { provide: RedisService, useValue: new FakeRedisService() },
      ],
    }));
  });

  afterAll(async () => {
    await app.close();
    process.env = savedEnv;
  });

  it('route sans décorateur, sans jeton : 401', async () => {
    expect((await fetch(`${baseUrl}/nouveau/secret`)).status).toBe(401);
  });

  it('route sans décorateur, jeton forgé : 401', async () => {
    const res = await fetch(`${baseUrl}/nouveau/secret`, {
      headers: { Authorization: 'Bearer forge.forge.forge' },
    });
    expect(res.status).toBe(401);
  });

  it('route @Public() : 200 sans jeton', async () => {
    expect((await fetch(`${baseUrl}/nouveau/ouvert`)).status).toBe(200);
  });

  it('fonctionnalité désactivée : 404 AVANT l’authentification (et non 401)', async () => {
    expect((await fetch(`${baseUrl}/experimental`)).status).toBe(404);
  });
});
