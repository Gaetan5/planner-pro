import { resolveCliDatasourceUrl } from './database-url';

/**
 * S4 (r2) : la CLI Prisma (migrate, db) ne doit jamais viser le DSN root local hors
 * development/test, et doit utiliser TLS quand DATABASE_SSL=true.
 */
describe('resolveCliDatasourceUrl (prisma.config.ts, S4)', () => {
  const DSN = 'mysql://planner:pw@db:3306/planner_pro';

  it.each(['production', 'staging', 'test', undefined])(
    'NODE_ENV=%s sans DATABASE_URL : URL indéfinie (aucun repli root, generate reste possible)',
    (nodeEnv) => {
      expect(resolveCliDatasourceUrl({ NODE_ENV: nodeEnv })).toBeUndefined();
    },
  );

  it('NODE_ENV=development sans DATABASE_URL : repli local', () => {
    expect(resolveCliDatasourceUrl({ NODE_ENV: 'development' })).toContain('@localhost:3306');
  });

  it('DATABASE_URL sans TLS : renvoyée telle quelle', () => {
    expect(resolveCliDatasourceUrl({ NODE_ENV: 'production', DATABASE_URL: DSN })).toBe(DSN);
  });

  it('DATABASE_SSL=true : TLS strict et AC transmise à la CLI', () => {
    const url = new URL(
      resolveCliDatasourceUrl({
        NODE_ENV: 'production',
        DATABASE_URL: DSN,
        DATABASE_SSL: 'true',
        DATABASE_SSL_CA: '/run/secrets/mysql-ca.pem',
      }) as string,
    );
    expect(url.hostname).toBe('db');
    expect(url.searchParams.get('sslaccept')).toBe('strict');
    expect(url.searchParams.get('sslcert')).toBe('/run/secrets/mysql-ca.pem');
  });

  it('DATABASE_SSL=true : des paramètres TLS déjà présents dans le DSN ne sont pas affaiblis', () => {
    const url = new URL(
      resolveCliDatasourceUrl({
        NODE_ENV: 'production',
        DATABASE_URL: `${DSN}?sslaccept=accept_invalid_certs`,
        DATABASE_SSL: 'true',
      }) as string,
    );
    expect(url.searchParams.get('sslaccept')).toBe('strict');
  });
});
