import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * r40-a1 : le secret de webhook chiffré (`Project.githubWebhookSecret`) est masqué par défaut
 * (PRISMA_OMIT), mais un `select` explicite ou `omit: { ... : false }` le relit. Seuls les fichiers
 * ci-dessous peuvent le nommer dans `backend/src` :
 *  - github-webhook.service.ts : vérification de la signature et régénération ;
 *  - auth.service.ts : liaison du dépôt (`/auth/github/sync`), création du secret ;
 *  - prisma.service.ts : définition de l'omission globale (PRISMA_OMIT).
 * Toute autre occurrence (nouvelle lecture, DTO, journal, réponse) fait échouer ce test.
 */
const ALLOWED = new Set([
  'projects/github-webhook.service.ts',
  'auth/auth.service.ts',
  'prisma/prisma.service.ts',
]);
const SRC = join(__dirname, '..', '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('r40-a1 : githubWebhookSecret confiné à quelques fichiers', () => {
  const files = walk(SRC).filter((f) => /\.(ts|tsx|js)$/.test(f));
  const withSecret = files
    .filter((f) => readFileSync(f, 'utf8').includes('githubWebhookSecret'))
    .map((f) => relative(SRC, f).split('\\').join('/'));

  it('le balayage voit les sources', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('les fichiers autorisés le référencent bien (la liste ne périme pas)', () => {
    expect([...withSecret].sort()).toEqual([...ALLOWED].sort());
  });

  it('aucun autre fichier de src ne le mentionne', () => {
    expect(withSecret.filter((f) => !ALLOWED.has(f))).toEqual([]);
  });
});
