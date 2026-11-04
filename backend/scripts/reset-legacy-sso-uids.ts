/**
 * Remet à NULL les liaisons `User.ssoUid` posées par l'ancien code SSO (audit S10-d).
 *
 * L'ancien code posait `azure-ad:<oid|sub>` ou `google:<sub>` à partir d'un `id_token` NON vérifié
 * (tenant `common`, e-mail non contrôlé). Ces liaisons ne sont pas fiables et le format Azure a
 * changé (`azure-ad:<tid>:<oid>`). Une fois remises à NULL, les comptes sont relinés au prochain
 * login SSO par leur e-mail, dans le domaine prouvé de l'organisation.
 *
 * À EXÉCUTER MANUELLEMENT, après sauvegarde et AVANT la réactivation de FEATURE_SSO_ENABLED
 * (voir docs/security/runbook-phase2.md) :
 *   cd backend
 *   npx tsx --env-file=.env scripts/reset-legacy-sso-uids.ts            # rapport seul (aucune écriture)
 *   npx tsx --env-file=.env scripts/reset-legacy-sso-uids.ts --apply    # remise à NULL effective
 *   Option : --csv=<chemin>
 *
 * Idempotent : chaque mise à jour est conditionnée à la valeur lue ; une seconde passe annonce 0.
 * Les identifiants Azure déjà au nouveau format (`azure-ad:<GUID>:<oid>`) sont conservés. Les
 * identifiants `google:<sub>` ne se distinguent pas des anciens : le mode --apply est donc refusé
 * quand FEATURE_SSO_ENABLED=true. Le rapport CSV ne contient ni e-mail ni identifiant IdP.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { buildMariaDbOptions } from '../src/prisma/prisma.service';
import { defaultReportPath, parseArgs, writeCsvReport } from './lib/csv';

const CURRENT_AZURE_FORMAT =
  /^azure-ad:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[^:]+$/;

export interface SsoUidRow {
  id: string;
  ssoUid: string | null;
}

export function planLegacySsoUidReset(rows: SsoUidRow[]) {
  return rows
    .filter((r) => r.ssoUid && !CURRENT_AZURE_FORMAT.test(r.ssoUid))
    .map((r) => ({
      id: r.id,
      ssoUid: r.ssoUid as string,
      // Seul le fournisseur (préfixe) est rapporté, jamais l'identifiant IdP
      provider: (r.ssoUid as string).split(':')[0],
    }));
}

export async function runLegacySsoUidReset(prisma: PrismaClient, { apply }: { apply: boolean }) {
  const rows = await prisma.user.findMany({
    where: { ssoUid: { not: null } },
    select: { id: true, ssoUid: true },
  });
  const plan = planLegacySsoUidReset(rows);

  let updated = 0;
  if (apply && plan.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const entry of plan) {
        // Conditionnel sur la valeur lue : sans effet si elle a changé entre-temps
        const result = await tx.user.updateMany({
          where: { id: entry.id, ssoUid: entry.ssoUid },
          data: { ssoUid: null },
        });
        updated += result.count;
      }
    });
  }
  return { plan, updated };
}

async function main() {
  const { apply, csvPath } = parseArgs(process.argv.slice(2));
  if (apply && process.env.FEATURE_SSO_ENABLED === 'true') {
    throw new Error(
      'Refusé : FEATURE_SSO_ENABLED=true. Exécuter --apply avant la réactivation du SSO, sinon les liaisons valides seraient perdues.',
    );
  }
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(buildMariaDbOptions()) });
  try {
    const { plan, updated } = await runLegacySsoUidReset(prisma, { apply });
    const mode = apply ? 'APPLIQUÉ' : 'RAPPORT';
    const path = writeCsvReport(
      csvPath ?? defaultReportPath('reset-legacy-sso-uids', apply),
      ['mode', 'userId', 'fournisseur', 'action'],
      plan.map((e) => [mode, e.id, e.provider, 'SSOUID_REMIS_A_NULL']),
    );
    console.log(`Liaisons SSO héritées : ${plan.length}`);
    console.log(`Rapport CSV : ${path}`);
    console.log(
      apply
        ? `Liaisons remises à NULL : ${updated}.`
        : 'Mode rapport : aucune donnée modifiée. Relancer avec --apply pour remettre à NULL.',
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
