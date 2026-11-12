import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * S23, S24 : le démarrage réel (`main.ts`) et le module racine doivent câbler `trust proxy`, les
 * limites de corps et le stockage Redis du limiteur. Les bancs HTTP reproduisent ces réglages ;
 * ce test fige le vrai câblage (même approche que `main-raw-body.spec.ts`).
 */
describe('S23/S24 : câblage de main.ts et du module racine', () => {
  const main = readFileSync(join(__dirname, '../../src/main.ts'), 'utf8');
  // A9-b0 : le câblage HTTP vit dans configure-http-app.ts, appelé par main.ts et par le banc e2e
  const wiring = readFileSync(join(__dirname, '../../src/common/configure-http-app.ts'), 'utf8');
  const appModule = readFileSync(join(__dirname, '../../src/app.module.ts'), 'utf8');

  it('main.ts règle trust proxy avant les analyseurs de corps et le middleware CORS/origine', () => {
    expect(main).toContain('configureHttpApp(app)');
    const trust = wiring.indexOf('configureTrustProxy(app');
    const bodies = wiring.indexOf('registerBodyParsers(app)');
    const origin = wiring.indexOf('originCheckMiddleware()');
    expect(trust).toBeGreaterThan(-1);
    expect(bodies).toBeGreaterThan(trust);
    expect(origin).toBeGreaterThan(bodies);
  });

  it('le limiteur global utilise le stockage Redis, pas la mémoire locale', () => {
    expect(appModule).toContain('ThrottlerModule.forRootAsync');
    expect(appModule).toContain('new RedisThrottlerStorage(redis)');
    expect(appModule).not.toMatch(/ThrottlerModule\.forRoot\(/);
  });

  it('docker-compose.prod.yml fournit TRUST_PROXY_HOPS au backend (obligatoire en production)', () => {
    const compose = readFileSync(join(__dirname, '../../../docker-compose.prod.yml'), 'utf8');
    expect(compose).toMatch(/TRUST_PROXY_HOPS: \$\{TRUST_PROXY_HOPS:\?/);
    // r44-m3 : aucune valeur par défaut silencieuse
    expect(compose).not.toMatch(/TRUST_PROXY_HOPS:-/);
    const example = readFileSync(join(__dirname, '../../../.env.production.example'), 'utf8');
    expect(example).toMatch(/^TRUST_PROXY_HOPS=\d$/m);
  });
});
