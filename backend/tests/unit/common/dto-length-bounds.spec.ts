import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { getMetadataStorage } from 'class-validator';
import { ConfigureSsoDto } from '../../../src/auth/sso/sso.dto';
import { encrypt } from '../../../src/auth/encryption.util';

/**
 * P7-b (r51-m3) : tout champ texte (ou tableau de chaînes) d'un DTO exposé porte une borne de
 * longueur. Sans borne, une chaîne de 300 000 caractères traverse la validation et frappe la
 * colonne VARCHAR(191) (500) ou remplit la base jusqu'à la limite de 1 Mo du corps.
 *
 * Le test lit les métadonnées `class-validator` de TOUTES les classes exportées par les fichiers
 * source qui importent `class-validator` : un DTO ajouté plus tard est couvert sans rien déclarer.
 * Sont « texte » les champs validés par `@IsString`, `@IsEmail`, `@IsUrl`, `@Matches`, ou un
 * validateur de chaîne maison. Les formats à valeurs fermées ou de longueur fixe (`@IsUUID`,
 * `@IsEnum`, `@IsIn`, `@IsISO8601`) ne sont pas du texte libre et ne sont pas concernés.
 */
const SRC = path.resolve(__dirname, '../../../src');

const TEXT_VALIDATORS = new Set([
  'isString',
  'isEmail',
  'isUrl',
  'matches',
  'isNumberString',
  'isSafeAttachmentUrl',
]);

/**
 * Exceptions admises (`Classe.champ` : raison). Vide : chaque champ texte porte une borne explicite.
 * Une entrée n'est acceptable que si la longueur est déjà bornée par ailleurs ET documentée ici.
 */
const EXEMPT: Record<string, string> = {};

/**
 * Un motif ancré (`^...$`) sans `*`, `+` ni `{n,}` n'accepte qu'une longueur maximale finie
 * (ex. `^\\d{6}$`, `^[a-f0-9]{64}$`) : le motif lui-même est la borne.
 */
export function isBoundedPattern(pattern: unknown): boolean {
  if (!(pattern instanceof RegExp)) return false;
  const { source } = pattern;
  return source.startsWith('^') && source.endsWith('$') && !/[*+]|\{\d+,\}/.test(source);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith('.ts') || /\.(spec|e2e-spec)\.ts$/.test(entry.name)) return [];
    return /from 'class-validator'/.test(fs.readFileSync(full, 'utf8')) ? [full] : [];
  });
}

interface Violation {
  field: string;
  problem: string;
}

/** Classe quelconque (constructeur). */
type Ctor = new (...args: never[]) => object;

function inspect(target: Ctor): Violation[] {
  const metas = getMetadataStorage().getTargetValidationMetadatas(
    target,
    undefined as unknown as string,
    false,
    false,
  );
  const byProperty = new Map<string, typeof metas>();
  for (const meta of metas) {
    byProperty.set(meta.propertyName, [...(byProperty.get(meta.propertyName) ?? []), meta]);
  }
  const out: Violation[] = [];
  for (const [property, list] of byProperty) {
    const field = `${target.name}.${property}`;
    // Éléments (tableau de chaînes) et valeur seule sont bornés séparément
    for (const each of [false, true]) {
      const texts = list.filter((m) => !!m.each === each && TEXT_VALIDATORS.has(m.name ?? ''));
      if (texts.length === 0) continue;
      // `@MaxLength(max)` : constraints = [max] ; `@Length(min, max)` : constraints = [min, max]
      const bounded = list.some(
        (m) =>
          !!m.each === each &&
          ((m.name === 'maxLength' && typeof m.constraints?.[0] === 'number') ||
            (m.name === 'isLength' && typeof m.constraints?.[1] === 'number') ||
            (m.name === 'matches' && isBoundedPattern(m.constraints?.[0]))),
      );
      if (!bounded) {
        out.push({ field, problem: each ? 'éléments de tableau sans borne' : 'texte sans borne' });
      }
    }
    // Un tableau sans taille maximale multiplie la longueur de chaque élément
    const isArray = list.some((m) => m.name === 'isArray');
    if (isArray && !list.some((m) => m.name === 'arrayMaxSize')) {
      out.push({ field, problem: 'tableau sans @ArrayMaxSize' });
    }
  }
  return out;
}

describe('P7-b : bornes de longueur des champs texte des DTO', () => {
  const files = sourceFiles(SRC);
  const classes: Ctor[] = [];
  for (const file of files) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const value of Object.values(mod))
      if (typeof value === 'function') classes.push(value as Ctor);
  }
  const dtos = [...new Set(classes)].filter(
    (c) =>
      getMetadataStorage().getTargetValidationMetadatas(
        c,
        undefined as unknown as string,
        false,
        false,
      ).length > 0,
  );

  it('le parcours est assez large pour être significatif', () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(dtos.length).toBeGreaterThanOrEqual(60);
  });

  it('aucun champ texte ni tableau de chaînes sans borne (hors exceptions justifiées)', () => {
    const violations = dtos
      .flatMap(inspect)
      .filter((v) => !(v.field in EXEMPT))
      .map((v) => `${v.field} : ${v.problem}`)
      .sort();
    expect(violations).toEqual([]);
  });

  it('un motif n’est une borne que s’il est ancré et fini', () => {
    expect(isBoundedPattern(/^\d{6}$/)).toBe(true);
    expect(isBoundedPattern(/^[a-f0-9]{64}$/)).toBe(true);
    expect(isBoundedPattern(/^[A-Za-z0-9-]{1,39}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/)).toBe(true);
    expect(isBoundedPattern(/^\d+$/)).toBe(false);
    expect(isBoundedPattern(/^.*$/)).toBe(false);
    expect(isBoundedPattern(/^a{3,}$/)).toBe(false);
    expect(isBoundedPattern(/\d{6}/)).toBe(false);
  });

  it('chaque exception est justifiée et correspond à un champ qui existe encore', () => {
    const known = new Set(dtos.flatMap(inspect).map((v) => v.field));
    for (const [field, reason] of Object.entries(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(known.has(field)).toBe(true);
    }
  });

  it('SSO : la borne du secret client est celle que la colonne VARCHAR(191) accepte une fois chiffré', () => {
    const bound = (
      getMetadataStorage()
        .getTargetValidationMetadatas(ConfigureSsoDto, undefined as unknown as string, false, false)
        .find((m) => m.propertyName === 'clientSecret' && m.name === 'maxLength')!
        .constraints as number[]
    )[0];
    const previous = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'super-secret-key-32-bytes-long!!';
    try {
      expect(encrypt('x'.repeat(bound)).length).toBeLessThanOrEqual(191);
      expect(encrypt('x'.repeat(bound + 1)).length).toBeGreaterThan(191);
    } finally {
      if (previous === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = previous;
    }
  });
});
