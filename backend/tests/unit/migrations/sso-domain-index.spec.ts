import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * S10-g : `domain` n'est plus unique ; un index non unique le remplace. Le contrôle exact
 * (`prisma migrate diff`) exige une base fantôme : ce test vérifie statiquement la cohérence
 * entre le schéma et la migration, sans base.
 */
describe('S10-g : index de SSOConfiguration.domain', () => {
  const root = join(__dirname, '../../../prisma');
  const schema = readFileSync(join(root, 'schema/workspace.prisma'), 'utf8');
  const migration = readFileSync(
    join(root, 'migrations/20261110000000_s10_s11_sso_domain_and_scim_keys/migration.sql'),
    'utf8',
  );
  const model = schema.slice(
    schema.indexOf('model SSOConfiguration'),
    schema.indexOf('model SCIMApiKey'),
  );

  it('le schéma déclare @@index([domain]) et plus d’unicité sur domain', () => {
    expect(model).toContain('@@index([domain])');
    expect(model).not.toMatch(/domain\s+String\s+@unique/);
  });

  it('la migration supprime l’index unique et crée l’index non unique SSOConfiguration_domain_idx', () => {
    expect(migration).toContain('DROP INDEX `SSOConfiguration_domain_key`');
    expect(migration).toContain(
      'CREATE INDEX `SSOConfiguration_domain_idx` ON `SSOConfiguration`(`domain`)',
    );
  });
});
