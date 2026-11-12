import { LoggerService } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { E2eWorld } from '../support/e2e-world';

/**
 * A9-b0 / R1 : table des routes de l'application complète (lignes `Mapped {chemin, MÉTHODE} route`
 * du journal Nest au démarrage), figée sur la pile actuelle. Après la montée de NestJS et
 * d'Express (A9-b2), elle doit rester identique : un chemin ou une méthode qui change est une
 * rupture de contrat d'API. Pour régénérer la référence après un ajout voulu de route :
 * `A9B0_WRITE_ROUTES=1` (le diff du fichier est alors à relire).
 */
const REFERENCE = join(__dirname, 'a9b0-routes.reference.txt');

class RouteCollector implements LoggerService {
  readonly routes: string[] = [];
  log(message: unknown) {
    const text = String(message);
    if (text.startsWith('Mapped {')) this.routes.push(text);
  }
  error() {}
  warn() {}
}

describe('A9-b0 e2e : table des routes', () => {
  const collector = new RouteCollector();
  let world: E2eWorld;
  beforeAll(async () => {
    world = await E2eWorld.start({ logger: collector });
  });
  afterAll(async () => {
    await world?.close();
  });

  it('les routes déclarées sont exactement celles de la référence (chemin et méthode)', () => {
    const actual = [...new Set(collector.routes)].sort().join('\n') + '\n';
    if (process.env.A9B0_WRITE_ROUTES === '1') writeFileSync(REFERENCE, actual);
    expect(collector.routes.length).toBeGreaterThan(100);
    expect(actual).toBe(readFileSync(REFERENCE, 'utf8'));
  });

  it('aucune route ne contient de joker, de segment optionnel ni d’expression (syntaxe Express 5, R1)', () => {
    for (const line of collector.routes) {
      const path = /^Mapped \{(.*), [A-Z]+\} route$/.exec(line)?.[1] ?? '';
      expect([line, /[*?+()[\]]/.test(path)]).toEqual([line, false]);
    }
  });
});
