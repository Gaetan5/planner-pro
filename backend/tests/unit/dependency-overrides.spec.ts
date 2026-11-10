import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * S25 : les correctifs de dépendances vulnérables ne doivent pas régresser en silence. Le test lit
 * le fichier de verrouillage réellement installé par la CI (`--frozen-lockfile`) et exige une
 * version minimale pour chaque paquet corrigé, ainsi que des surcharges identiques dans les deux
 * fichiers qui les portent (pnpm 10 lit `pnpm-workspace.yaml`, pnpm 9 lit `package.json#pnpm`).
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

  it('les surcharges de pnpm-workspace.yaml et de package.json#pnpm sont identiques', () => {
    const fromJson: Record<string, string> = rootPackage.pnpm.overrides;
    const section = workspace.split(/^overrides:\n/m)[1] ?? '';
    const fromYaml: Record<string, string> = {};
    for (const line of section.split('\n')) {
      const match = line.match(/^ {2}'?([^':]+)'?: '([^']+)'$/);
      if (match) fromYaml[match[1]] = match[2];
      else if (line.trim() !== '' && !line.startsWith('  ')) break;
    }
    expect(fromYaml).toEqual(fromJson);
    // Chaque paquet surchargé est borné par une version majeure (pas de saut de majeure involontaire)
    for (const range of Object.values(fromJson)) expect(range).toMatch(/^>=[\d.]+ <\d+$/);
  });

  it('le fichier de verrouillage porte les mêmes surcharges', () => {
    const fromJson: Record<string, string> = rootPackage.pnpm.overrides;
    for (const [name, range] of Object.entries(fromJson)) {
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
