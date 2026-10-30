import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { readFileSync } from 'fs';
import { isLocalEnvironment as isLocal, LOCAL_DEFAULT_DATABASE_URL } from './database-url';

export interface MariaDbConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  allowPublicKeyRetrieval: boolean;
  ssl?: { rejectUnauthorized: true; ca?: string };
  cachingRsaPublicKey?: string;
}

/**
 * Construit les options de connexion MariaDB/MySQL à partir de l'environnement (S4) :
 * - aucun repli vers le DSN root local hors `development`/`test` ;
 * - TLS vérifié si `DATABASE_SSL=true` (autorité facultative `DATABASE_SSL_CA`, chemin de fichier) ;
 * - TLS obligatoire en production ;
 * - clé publique RSA du serveur épinglée si `DATABASE_RSA_PUBLIC_KEY` (chemin de fichier),
 *   tolérée seulement hors production ;
 * - `allowPublicKeyRetrieval` seulement en développement/test sans TLS ni clé épinglée,
 *   car un intermédiaire pourrait sinon fournir sa propre clé et obtenir le mot de passe.
 */
export function buildMariaDbOptions(
  env: NodeJS.ProcessEnv = process.env,
): MariaDbConnectionOptions {
  const isLocalEnvironment = isLocal(env);

  if (!env.DATABASE_URL && !isLocalEnvironment) {
    throw new Error(
      "La variable d'environnement DATABASE_URL est obligatoire hors développement et test (Fail-Fast).",
    );
  }

  const parsed = new URL(env.DATABASE_URL || LOCAL_DEFAULT_DATABASE_URL);
  const sslEnabled = env.DATABASE_SSL === 'true';

  // TLS obligatoire en production : la clé RSA épinglée protège le mot de passe mais ne chiffre
  // pas le trafic ; elle n'est tolérée qu'en développement et en staging (S4).
  if (env.NODE_ENV === 'production' && !sslEnabled) {
    throw new Error(
      'DATABASE_SSL=true est obligatoire en production (connexion MySQL chiffrée et vérifiée).',
    );
  }
  const pinnedPublicKey = env.DATABASE_RSA_PUBLIC_KEY
    ? readFileSync(env.DATABASE_RSA_PUBLIC_KEY, 'utf8')
    : undefined;

  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '3306', 10),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password || ''),
    database: parsed.pathname.substring(1),
    allowPublicKeyRetrieval: isLocalEnvironment && !sslEnabled && !pinnedPublicKey,
    ...(sslEnabled
      ? {
          ssl: {
            rejectUnauthorized: true as const,
            ...(env.DATABASE_SSL_CA ? { ca: readFileSync(env.DATABASE_SSL_CA, 'utf8') } : {}),
          },
        }
      : {}),
    ...(pinnedPublicKey ? { cachingRsaPublicKey: pinnedPublicKey } : {}),
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const adapter = new PrismaMariaDb(buildMariaDbOptions());
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();

    await this.seedDefaultUser();
  }

  private async seedDefaultUser() {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const defaultUserId = 'default-user-id';
    const user = await this.user.findUnique({
      where: { id: defaultUserId },
    });

    if (!user) {
      await this.user.create({
        data: {
          id: defaultUserId,
          email: 'gaetan@planner.pro',
          name: 'Gaëtan',
        },
      });
      console.log('Default user seeded: Gaëtan (default-user-id)');
    }
  }
}
