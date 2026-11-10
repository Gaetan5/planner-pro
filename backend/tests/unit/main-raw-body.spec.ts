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

  it('le parseur JSON est enregistré par app.useBodyParser (qui pose le rawBody)', () => {
    expect(main).toContain("app.useBodyParser('json'");
  });
});
