import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * S21 : sans `rawBody: true`, `req.rawBody` est absent et aucune signature de webhook ne peut être
 * vérifiée sur le corps exact. Le banc HTTP reproduit ce réglage ; ce test fige le vrai démarrage.
 */
describe('S21 : main.ts conserve le corps brut', () => {
  const main = readFileSync(join(__dirname, '../../src/main.ts'), 'utf8');

  it('NestFactory.create reçoit rawBody: true', () => {
    expect(main).toMatch(/NestFactory\.create<[^>]+>\(AppModule,\s*\{[^}]*rawBody:\s*true/s);
  });

  it('les parseurs JSON sont enregistrés par app.useBodyParser (qui pose le rawBody)', () => {
    expect(main).toContain('configureHttpApp(app)');
    const wiring = readFileSync(join(__dirname, '../../src/common/configure-http-app.ts'), 'utf8');
    expect(wiring).toContain('registerBodyParsers(app)');
    const parsers = readFileSync(join(__dirname, '../../src/common/body-parsers.ts'), 'utf8');
    expect(parsers).toContain("app.useBodyParser('json'");
  });
});
