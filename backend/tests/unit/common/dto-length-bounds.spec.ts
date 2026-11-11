import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import {
  Allow,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  getMetadataStorage,
} from 'class-validator';
import { ConfigureSsoDto } from '../../../src/auth/sso/sso.dto';
import { encrypt } from '../../../src/auth/encryption.util';

/**
 * P7-b (r51-m3) : tout champ texte (ou tableau de chaînes) d'un DTO exposé porte une borne de
 * longueur. Sans borne, une chaîne de 300 000 caractères traverse la validation et frappe la
 * colonne VARCHAR(191) (500) ou remplit la base jusqu'à la limite de 1 Mo du corps.
 *
 * Le test lit les métadonnées `class-validator` de TOUTES les classes exportées par les fichiers
 * source qui importent `class-validator` : un DTO ajouté plus tard est couvert sans rien déclarer.
 * Sont « texte » les champs validés par `@IsString`, `@IsEmail`, `@IsUrl`, `@Matches`, `@IsISO8601`,
 * `@IsDateString` (l'expression de `validator` admet des décimales en nombre quelconque), ou un
 * validateur de chaîne maison. Les formats à valeurs fermées ou de longueur fixe (`@IsUUID`,
 * `@IsEnum`, `@IsIn`) ne sont pas du texte libre et ne sont pas concernés.
 *
 * N4 : un champ qui ne porte AUCUN validateur de type reconnu (`@Allow`, `@IsOptional` ou
 * `@IsNotEmpty` seuls) est refusé : il accepterait n'importe quelle valeur, donc n'importe quelle
 * longueur, sans que le garde puisse l'examiner (exceptions justifiées dans `UNTYPED_EXEMPT`).
 */
const SRC = path.resolve(__dirname, '../../../src');

const TEXT_VALIDATORS = new Set([
  'isString',
  'isEmail',
  'isUrl',
  'matches',
  'isNumberString',
  'isSafeAttachmentUrl',
  'isIso8601',
  'isDateString',
]);

/**
 * Validateurs qui fixent le type de la valeur : texte (ci-dessus), nombre, booléen, valeur fermée,
 * UUID, date, objet ou tableau. `@ValidateNested` est reconnu par son type de métadonnée.
 */
const TYPE_VALIDATORS = new Set([
  ...TEXT_VALIDATORS,
  'isInt',
  'isNumber',
  'isBoolean',
  'isIn',
  'isEnum',
  'isUuid',
  'isDate',
  'isObject',
  'isArray',
]);

/**
 * Exceptions admises (`Classe.champ` : raison). Vide : chaque champ texte porte une borne explicite.
 * Une entrée n'est acceptable que si la longueur est déjà bornée par ailleurs ET documentée ici.
 */
const EXEMPT: Record<string, string> = {};

/**
 * Exceptions au contrôle « un type reconnu » (`Classe.champ` : raison). Une entrée n'est acceptable
 * que si le service qui consomme la valeur la contrôle lui-même, ce qui doit être documenté ici.
 */
const UNTYPED_EXEMPT: Record<string, string> = {
  'ScimPatchOperationDto.value':
    "Valeur SCIM de forme libre (chaîne, objet, tableau, booléen selon l'attribut) : ScimService.patchUser la contrôle par scimText (400 invalidValue au-delà de 191 caractères, N3) ; la taille totale reste limitée par la limite du corps de requête.",
};

/**
 * Un motif ancré (`^...$`) sans `*`, `+` ni `{n,}` n'accepte qu'une longueur maximale finie
 * (ex. `^\\d{6}$`, `^[a-f0-9]{64}$`) : le motif lui-même est la borne.
 */
export function isBoundedPattern(pattern: unknown): boolean {
  if (!(pattern instanceof RegExp)) return false;
  const { source } = pattern;
  return (
    source.startsWith('^') &&
    source.endsWith('$') &&
    !/[*+]|\{\d+,\}/.test(source) &&
    !hasTopLevelAlternation(source)
  );
}

/**
 * N4 : `/^a|b$/` commence par `^` et finit par `$` mais se lit « `^a` OU `b$` » : il accepte toute
 * chaîne commençant par `a`. Une alternance hors groupe fait perdre l'ancrage ; seule une
 * alternance enfermée dans un groupe (`^(?:a|b)$`) est admise.
 */
function hasTopLevelAlternation(source: string): boolean {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') i++;
    else if (inClass) inClass = c !== ']';
    else if (c === '[') inClass = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) return true;
  }
  return false;
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

const UNTYPED = 'aucun validateur de type reconnu';

function isExempt(v: Violation): boolean {
  return v.field in EXEMPT || (v.problem === UNTYPED && v.field in UNTYPED_EXEMPT);
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
    // N4 : aucun validateur de type reconnu (`@Allow`, `@IsOptional`, `@IsNotEmpty` seuls)
    const typed = list.some(
      (m) => TYPE_VALIDATORS.has(m.name ?? '') || m.type === 'nestedValidation',
    );
    if (!typed) out.push({ field, problem: UNTYPED });
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
      .filter((v) => !isExempt(v))
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
    // N4 : alternance hors groupe, les ancres ne portent que sur une branche chacune
    expect(isBoundedPattern(/^a|b$/)).toBe(false);
    expect(isBoundedPattern(/^a$|^b$/)).toBe(false);
    expect(isBoundedPattern(/^(?:a|b)$/)).toBe(true);
    expect(isBoundedPattern(/^[|a]{3}$/)).toBe(true);
    expect(isBoundedPattern(/^a\|b$/)).toBe(true);
  });

  it('N4 : le garde détecte les trois angles morts (dates ISO, alternance, champ sans type)', () => {
    class Dates {
      @IsISO8601()
      date!: string;
      @IsISO8601()
      @MaxLength(64)
      bounded!: string;
    }
    class Alternation {
      @Matches(/^a|b$/)
      pattern!: string;
      @Matches(/^(?:a|b)$/)
      grouped!: string;
    }
    class Untyped {
      @Allow()
      anything!: unknown;
      @IsOptional()
      @IsNotEmpty()
      maybe?: unknown;
      @IsString()
      @MaxLength(10)
      fine!: string;
    }
    expect(inspect(Dates)).toEqual([{ field: 'Dates.date', problem: 'texte sans borne' }]);
    expect(inspect(Alternation)).toEqual([
      { field: 'Alternation.pattern', problem: 'texte sans borne' },
    ]);
    expect(inspect(Untyped)).toEqual([
      { field: 'Untyped.anything', problem: UNTYPED },
      { field: 'Untyped.maybe', problem: UNTYPED },
    ]);
  });

  it('chaque exception est justifiée et correspond à un champ qui existe encore', () => {
    const known = new Set(dtos.flatMap(inspect).map((v) => v.field));
    for (const [field, reason] of Object.entries({ ...EXEMPT, ...UNTYPED_EXEMPT })) {
      expect(reason.length).toBeGreaterThan(20);
      expect(known.has(field)).toBe(true);
    }
    // Une exception de type ne vaut que pour un champ réellement sans type
    for (const field of Object.keys(UNTYPED_EXEMPT)) {
      expect(dtos.flatMap(inspect)).toContainEqual({ field, problem: UNTYPED });
    }
  });

  it('SSO (N6) : colonne TEXT, et le secret de longueur maximale, chiffré, y tient même en caractères larges', () => {
    const bound = (
      getMetadataStorage()
        .getTargetValidationMetadatas(ConfigureSsoDto, undefined as unknown as string, false, false)
        .find((m) => m.propertyName === 'clientSecret' && m.name === 'maxLength')!
        .constraints as number[]
    )[0];
    expect(bound).toBe(1024);
    const schema = fs.readFileSync(
      path.resolve(__dirname, '../../../prisma/schema/workspace.prisma'),
      'utf8',
    );
    expect(schema).toMatch(/clientSecret\s+String\?\s+@db\.Text/);
    const previous = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'super-secret-key-32-bytes-long!!';
    try {
      // 3 octets UTF-8 par unité UTF-16 au pire (« € ») : 58 + 2 x 3 072 caractères hexadécimaux
      expect(encrypt('€'.repeat(bound)).length).toBe(58 + 2 * 3 * bound);
      expect(encrypt('€'.repeat(bound)).length).toBeLessThan(65_535);
    } finally {
      if (previous === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = previous;
    }
  });
});
