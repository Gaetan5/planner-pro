/**
 * Chiffre les secrets client SSO encore stockés en clair (audit S10).
 *
 * À EXÉCUTER MANUELLEMENT, après sauvegarde (voir docs/security/runbook-phase2.md) :
 *   cd backend
 *   npx tsx --env-file=.env scripts/encrypt-sso-secrets.ts            # rapport seul (aucune écriture)
 *   npx tsx --env-file=.env scripts/encrypt-sso-secrets.ts --apply    # chiffrement effectif
 *   Option : --csv=<chemin>
 *
 * Variables requises : DATABASE_URL, ENCRYPTION_KEY (et NODE_ENV/DATABASE_SSL comme pour l'API).
 * Un secret chiffré a le format `iv:tag:data` (hexadécimal). Idempotent : chaque mise à jour est
 * conditionnée à la valeur lue. Le rapport CSV ne contient jamais de secret.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { buildMariaDbOptions } from '../src/prisma/prisma.service';
import { encrypt } from '../src/auth/encryption.util';
import { defaultReportPath, parseArgs, writeCsvReport } from './lib/csv';

const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;

export interface SsoSecretRow {
  id: string;
  domain: string;
  clientSecret: string | null;
}

export function planSsoSecretEncryption(rows: SsoSecretRow[]) {
  return rows
    .filter((r) => r.clientSecret && !ENCRYPTED_FORMAT.test(r.clientSecret))
    .map((r) => ({ id: r.id, domain: r.domain, plain: r.clientSecret as string }));
}

export async function runSsoSecretEncryption(prisma: PrismaClient, { apply }: { apply: boolean }) {
  const rows = await prisma.sSOConfiguration.findMany({
    where: { clientSecret: { not: null } },
    select: { id: true, domain: true, clientSecret: true },
  });
  const plan = planSsoSecretEncryption(rows);

  let updated = 0;
  if (apply && plan.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const entry of plan) {
        // Conditionnel sur la valeur en clair lue : sans effet si elle a changé entre-temps
        const result = await tx.sSOConfiguration.updateMany({
          where: { id: entry.id, clientSecret: entry.plain },
          data: { clientSecret: encrypt(entry.plain) },
        });
        updated += result.count;
      }
    });
  }
  return { plan, updated };
}

async function main() {
  const { apply, csvPath } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(buildMariaDbOptions()) });
  try {
    const { plan, updated } = await runSsoSecretEncryption(prisma, { apply });
    const mode = apply ? 'APPLIQUÉ' : 'RAPPORT';
    const path = writeCsvReport(
      csvPath ?? defaultReportPath('encrypt-sso-secrets', apply),
      ['mode', 'configurationId', 'domaine', 'action'],
      plan.map((e) => [mode, e.id, e.domain, 'SECRET_CHIFFRÉ']),
    );
    console.log(`Secrets SSO en clair : ${plan.length}`);
    console.log(`Rapport CSV : ${path}`);
    console.log(
      apply
        ? `Secrets chiffrés : ${updated}.`
        : 'Mode rapport : aucune donnée modifiée. Relancer avec --apply pour chiffrer.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
