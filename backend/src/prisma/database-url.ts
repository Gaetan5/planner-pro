/**
 * Règles communes de résolution de l'URL de base de données (audit S4), sans dépendance Nest :
 * utilisées par PrismaService (adaptateur MariaDB) et par prisma.config.ts (CLI Prisma).
 */

/** Environnements où le DSN local par défaut et la récupération de clé publique sont tolérés. */
export const LOCAL_ENVIRONMENTS = ['development', 'test'];
export const LOCAL_DEFAULT_DATABASE_URL = 'mysql://root:root_password@localhost:3306/planner_pro';

/**
 * Seul le développement retombe sur le DSN root local (A7) : en test, un repli viserait la base de
 * développement de la machine. Les tests fixent `DATABASE_URL` (tests/support/jest-env.ts).
 */
export function allowsLocalDsnFallback(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'development';
}

export function isLocalEnvironment(env: NodeJS.ProcessEnv): boolean {
  return LOCAL_ENVIRONMENTS.includes(env.NODE_ENV ?? '');
}

/**
 * URL utilisée par la CLI Prisma (migrate, db). Hors development/test et sans DATABASE_URL, elle
 * reste indéfinie : `prisma generate` (build) fonctionne, mais toute commande qui se connecte
 * échoue explicitement au lieu de viser le DSN root local.
 * Avec DATABASE_SSL=true, le TLS strict est imposé à la CLI (paramètres Prisma `sslaccept` et
 * `sslcert`), pour que `migrate deploy` passe avec `require_secure_transport=ON`.
 */
export function resolveCliDatasourceUrl(env: NodeJS.ProcessEnv): string | undefined {
  const rawUrl =
    env.DATABASE_URL || (allowsLocalDsnFallback(env) ? LOCAL_DEFAULT_DATABASE_URL : undefined);
  if (!rawUrl || env.DATABASE_SSL !== 'true') {
    return rawUrl;
  }

  const url = new URL(rawUrl);
  url.searchParams.set('sslaccept', 'strict');
  if (env.DATABASE_SSL_CA) {
    url.searchParams.set('sslcert', env.DATABASE_SSL_CA);
  }
  return url.toString();
}
