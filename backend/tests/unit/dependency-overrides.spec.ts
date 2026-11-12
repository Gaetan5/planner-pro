import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * S25 : les correctifs de dépendances vulnérables ne doivent pas régresser en silence. Le test lit
 * le fichier de verrouillage réellement installé par la CI (`--frozen-lockfile`) et exige une
 * version minimale pour chaque paquet corrigé. A9 : pnpm 10 est épinglé et la seule source des
 * surcharges est `pnpm-workspace.yaml` (`package.json#pnpm` n'est plus lu par les pnpm récents et
 * déclenche un avertissement : il ne doit plus exister).
 */
const ROOT = join(__dirname, '../../..');
const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
const workspace = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Version minimale corrigée de chaque paquet (avis `pnpm audit` du 2026-11-10). */
const MINIMUMS: Record<string, string> = {
  multer: '2.5.0',
  'socket.io-parser': '4.2.7',
  'engine.io': '6.6.10',
  ws: '8.21.0',
  'body-parser': '1.20.9',
  lodash: '4.18.0',
  mysql2: '3.23.1',
  'fast-uri': '3.1.9',
  qs: '6.16.1',
  '@grpc/grpc-js': '1.13.6',
  'deepmerge-ts': '8.0.0',
  valibot: '1.4.2',
  'file-type': '21.3.2',
  nodemailer: '10.0.13',
  cookie: '0.7.0',
};

const compare = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/** Versions résolues d'un paquet dans la section `packages:` du fichier de verrouillage. */
function lockedVersions(name: string): string[] {
  const escaped = name.replace(/[/.]/g, '\\$&');
  const pattern = new RegExp(`^ {2}'?${escaped}@(\\d+\\.\\d+\\.\\d+)'?:`, 'gm');
  return [...lock.matchAll(pattern)].map((match) => match[1]);
}

describe('S25 : versions corrigées des dépendances', () => {
  it.each(Object.entries(MINIMUMS))('%s est résolu en version ≥ %s partout', (name, minimum) => {
    const versions = lockedVersions(name);
    expect(versions.length).toBeGreaterThan(0);
    const outdated = versions.filter((version) => compare(version, minimum) < 0);
    expect(outdated).toEqual([]);
  });

  // A9-b2 : `body-parser` existe en deux majeures (1.x pour Express 4, outillage de développement ;
  // 2.x pour Express 5, donc pour NestJS 11). Une surcharge globale `<2` forcerait la 1.x sous
  // Express 5 et casserait `express.json` : chaque majeure a sa surcharge à sélecteur et son minimum.
  const MINIMUMS_BY_MAJOR: Record<string, Record<number, string>> = {
    'body-parser': { 1: '1.20.9', 2: '2.2.1' },
  };

  it.each(Object.entries(MINIMUMS_BY_MAJOR))(
    '%s : chaque majeure présente est résolue au moins à son minimum corrigé',
    (name, minimums) => {
      const versions = lockedVersions(name);
      expect(versions.length).toBeGreaterThan(0);
      for (const version of versions) {
        const major = Number(version.split('.')[0]);
        expect(minimums[major]).toBeDefined();
        expect(compare(version, minimums[major])).toBeGreaterThanOrEqual(0);
      }
      // Express 5 (NestJS 11) doit bien prendre la majeure 2
      expect(versions.some((version) => version.startsWith('2.'))).toBe(true);
    },
  );

  it('NestJS 11 s’exécute sur Express 5 (platform-express) et non sur la 4.x', () => {
    const backend = JSON.parse(readFileSync(join(ROOT, 'backend/package.json'), 'utf8'));
    expect(backend.dependencies['@nestjs/platform-express']).toMatch(/^11\./);
    expect(lock).toMatch(/^ {2}'@nestjs\/platform-express@11\.[\d.]+':/m);
    expect(lock).toMatch(
      /^ {2}'@nestjs\/platform-express@11\.[\d.]+\([^\n]*\)':\n {4}dependencies:\n(?: {6}[^\n]+\n)*? {6}express: 5\.\d+\.\d+\n/m,
    );
  });

  const overridesFromWorkspace = (): Record<string, string> => {
    const section = workspace.split(/^overrides:\n/m)[1] ?? '';
    const fromYaml: Record<string, string> = {};
    for (const line of section.split('\n')) {
      const match = line.match(/^ {2}'?([^':]+)'?: '([^']+)'$/);
      if (match) fromYaml[match[1]] = match[2];
      else if (line.trim() !== '' && !line.startsWith('  ')) break;
    }
    return fromYaml;
  };

  it('pnpm 10 est épinglé et package.json ne porte plus de surcharges (source unique : pnpm-workspace.yaml)', () => {
    expect(rootPackage.packageManager).toMatch(/^pnpm@10\.\d+\.\d+$/);
    expect(rootPackage.pnpm).toBeUndefined();
    expect(Object.keys(overridesFromWorkspace()).length).toBeGreaterThan(0);
  });

  it('les surcharges de pnpm-workspace.yaml sont bornées par une version majeure', () => {
    // Pas de saut de majeure involontaire
    for (const range of Object.values(overridesFromWorkspace())) {
      expect(range).toMatch(/^>=[\d.]+ <\d+$/);
    }
  });

  it('body-parser n’a aucune surcharge globale : elles portent un sélecteur de majeure', () => {
    const keys = Object.keys(overridesFromWorkspace()).filter((key) =>
      key.startsWith('body-parser'),
    );
    expect(keys.sort()).toEqual(['body-parser@<2', 'body-parser@>=2']);
    expect(overridesFromWorkspace()['body-parser@<2']).toMatch(/ <2$/);
    expect(overridesFromWorkspace()['body-parser@>=2']).toMatch(/^>=2\./);
  });

  it('le fichier de verrouillage porte les mêmes surcharges', () => {
    for (const [name, range] of Object.entries(overridesFromWorkspace())) {
      expect(lock).toMatch(
        new RegExp(`^ {2}'?${name.replace(/[/.]/g, '\\$&')}'?: '${range}'$`, 'm'),
      );
    }
  });

  it('nodemailer ^10.4.0 et cookie-parser 1.4.7 sont déclarés par le backend', () => {
    const backend = JSON.parse(readFileSync(join(ROOT, 'backend/package.json'), 'utf8'));
    expect(backend.dependencies.nodemailer).toBe('^10.4.0');
    expect(backend.dependencies['cookie-parser']).toBe('1.4.7');
  });
});
