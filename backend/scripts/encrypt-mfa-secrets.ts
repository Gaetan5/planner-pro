/**
 * Chiffre les secrets TOTP encore stockés en clair (audit S6).
 *
 * À EXÉCUTER MANUELLEMENT, après sauvegarde (voir docs/security/runbook-phase1.md) :
 *   cd backend
 *   npx tsx --env-file=.env scripts/encrypt-mfa-secrets.ts            # rapport seul (aucune écriture)
 *   npx tsx --env-file=.env scripts/encrypt-mfa-secrets.ts --apply    # chiffrement effectif
 *   Option : --csv=<chemin> (défaut : reprise-phase0/encrypt-mfa-secrets-<mode>-<date>.csv)
 *
 * Variables requises : DATABASE_URL, ENCRYPTION_KEY (et NODE_ENV/DATABASE_SSL comme pour l'API).
 *
 * Un secret chiffré a le format `iv:tag:data` (hexadécimal) ; un secret base32 en clair ne contient
 * jamais « : ». Le script ne touche que les valeurs en clair. Idempotent : chaque mise à jour est
 * conditionnée à la valeur lue, une seconde exécution ne trouve plus rien. Le rapport CSV ne
 * contient jamais de secret.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { buildMariaDbOptions } from '../src/prisma/prisma.service';
import { encrypt } from '../src/auth/encryption.util';
import { defaultReportPath, parseArgs, writeCsvReport } from './lib/csv';

const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;

export type MfaSecretField = 'mfaSecret' | 'mfaPendingSecret';

export interface MfaSecretRow {
  id: string;
  email: string;
  mfaSecret: string | null;
  mfaPendingSecret: string | null;
}

export interface MfaSecretPlanEntry {
  userId: string;
  email: string;
  field: MfaSecretField;
  /** Valeur lue (en clair) : sert de condition de mise à jour, jamais écrite dans le rapport. */
  plain: string;
}

export function isPlaintextSecret(value: string | null): value is string {
  return Boolean(value) && !ENCRYPTED_FORMAT.test(value as string);
}

/** Valeurs à chiffrer, sans accès à la base. */
export function planMfaSecretEncryption(rows: MfaSecretRow[]): MfaSecretPlanEntry[] {
  return rows.flatMap((row) =>
    (['mfaSecret', 'mfaPendingSecret'] as const)
      .filter((field) => isPlaintextSecret(row[field]))
      .map((field) => ({
        userId: row.id,
        email: row.email,
        field,
        plain: row[field] as string,
      })),
  );
}

export async function runMfaSecretEncryption(
  prisma: PrismaClient,
  { apply }: { apply: boolean },
): Promise<{ plan: MfaSecretPlanEntry[]; updated: number }> {
  const rows = await prisma.user.findMany({
    where: { OR: [{ mfaSecret: { not: null } }, { mfaPendingSecret: { not: null } }] },
    select: { id: true, email: true, mfaSecret: true, mfaPendingSecret: true },
  });
  const plan = planMfaSecretEncryption(rows);

  let updated = 0;
  if (apply && plan.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const entry of plan) {
        // Conditionnel sur la valeur en clair lue : sans effet si elle a changé entre-temps
        const result = await tx.user.updateMany({
          where: { id: entry.userId, [entry.field]: entry.plain },
          data: { [entry.field]: encrypt(entry.plain) },
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
    const { plan, updated } = await runMfaSecretEncryption(prisma, { apply });
    const mode = apply ? 'APPLIQUÉ' : 'RAPPORT';
    const path = writeCsvReport(
      csvPath ?? defaultReportPath('encrypt-mfa-secrets', apply),
      ['mode', 'userId', 'email', 'champ', 'action'],
      plan.map((e) => [mode, e.userId, e.email, e.field, 'SECRET_CHIFFRÉ']),
    );
    console.log(`Secrets TOTP en clair : ${plan.length}`);
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
