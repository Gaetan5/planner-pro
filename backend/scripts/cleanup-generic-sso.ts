/**
 * Reprise des comptes et memberships créés par l'ancien repli SSO « générique » (audit S2, S28).
 *
 * Le callback SSO authentifiait `user@<domaine>` SANS AUCUNE vérification pour les fournisseurs
 * SAML2 et OIDC_GENERIC (`ssoUid = generic:<domaine>:<code>`). Toute membership obtenue ainsi
 * l'a été sans authentification et doit être retirée.
 *
 * À EXÉCUTER MANUELLEMENT, après sauvegarde (voir docs/security/runbook-reprise-phase0.md) :
 *   cd backend
 *   npx tsx --env-file=.env scripts/cleanup-generic-sso.ts            # rapport seul (aucune écriture)
 *   npx tsx --env-file=.env scripts/cleanup-generic-sso.ts --apply    # application, en transaction
 *   Option : --csv=<chemin> (défaut : reprise-phase0/cleanup-generic-sso-<mode>-<date>.csv)
 *
 * Pour chaque utilisateur dont `ssoUid` commence par `generic:` :
 *  1. suppression de ses memberships dans les workspaces dont la configuration SSO est SAML2 ou
 *     OIDC_GENERIC (une membership OWNER est signalée, jamais supprimée) ;
 *  2. `ssoUid = NULL` ;
 *  3. `isSuspended = true` si le compte n'a ni mot de passe, ni Firebase, ni GitHub et plus
 *     aucune membership.
 * Idempotent : une fois `ssoUid` effacé, le compte n'est plus sélectionné.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { buildMariaDbOptions } from '../src/prisma/prisma.service';
import { defaultReportPath, parseArgs, writeCsvReport } from './lib/csv';

const GENERIC_PREFIX = 'generic:';
const GENERIC_PROVIDERS = ['SAML2', 'OIDC_GENERIC'];

export interface GenericSsoUser {
  id: string;
  email: string;
  passwordHash: string | null;
  firebaseUid: string | null;
  githubId: string | null;
  ssoUid: string | null;
  memberships: Array<{ workspaceId: string; role: string; ssoProvider: string | null }>;
}

export interface GenericSsoPlanEntry {
  userId: string;
  email: string;
  removeMembershipWorkspaceIds: string[];
  keptOwnerWorkspaceIds: string[];
  clearSsoUid: true;
  suspend: boolean;
}

/** Calcule les actions à appliquer, sans aucun accès à la base. */
export function planGenericSsoCleanup(users: GenericSsoUser[]): GenericSsoPlanEntry[] {
  return users.map((user) => {
    const fromGenericSso = user.memberships.filter(
      (m) => m.ssoProvider !== null && GENERIC_PROVIDERS.includes(m.ssoProvider),
    );
    const removeMembershipWorkspaceIds = fromGenericSso
      .filter((m) => m.role !== 'OWNER')
      .map((m) => m.workspaceId);
    const keptOwnerWorkspaceIds = fromGenericSso
      .filter((m) => m.role === 'OWNER')
      .map((m) => m.workspaceId);
    const remainingMemberships = user.memberships.length - removeMembershipWorkspaceIds.length;
    const hasOtherCredential = Boolean(user.passwordHash || user.firebaseUid || user.githubId);

    return {
      userId: user.id,
      email: user.email,
      removeMembershipWorkspaceIds,
      keptOwnerWorkspaceIds,
      clearSsoUid: true as const,
      suspend: !hasOtherCredential && remainingMemberships === 0,
    };
  });
}

async function loadGenericSsoUsers(prisma: PrismaClient): Promise<GenericSsoUser[]> {
  const users = await prisma.user.findMany({
    where: { ssoUid: { startsWith: GENERIC_PREFIX } },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      firebaseUid: true,
      githubId: true,
      ssoUid: true,
      memberships: {
        select: {
          workspaceId: true,
          role: true,
          workspace: { select: { ssoConfiguration: { select: { provider: true } } } },
        },
      },
    },
  });

  return users.map((user) => ({
    ...user,
    memberships: user.memberships.map((m) => ({
      workspaceId: m.workspaceId,
      role: m.role,
      ssoProvider: m.workspace.ssoConfiguration?.provider ?? null,
    })),
  }));
}

export async function runGenericSsoCleanup(
  prisma: PrismaClient,
  { apply }: { apply: boolean },
): Promise<{ plan: GenericSsoPlanEntry[] }> {
  const plan = planGenericSsoCleanup(await loadGenericSsoUsers(prisma));

  if (apply && plan.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const entry of plan) {
        if (entry.removeMembershipWorkspaceIds.length > 0) {
          // Garde-fou : jamais de suppression d'une membership OWNER
          await tx.membership.deleteMany({
            where: {
              userId: entry.userId,
              workspaceId: { in: entry.removeMembershipWorkspaceIds },
              role: { not: 'OWNER' },
            },
          });
        }
        // Mise à jour conditionnelle : sans effet si le compte a déjà été traité
        await tx.user.updateMany({
          where: { id: entry.userId, ssoUid: { startsWith: GENERIC_PREFIX } },
          data: { ssoUid: null, ...(entry.suspend ? { isSuspended: true } : {}) },
        });
      }
    });
  }

  return { plan };
}

function planToCsvRows(plan: GenericSsoPlanEntry[], apply: boolean): unknown[][] {
  const mode = apply ? 'APPLIQUÉ' : 'RAPPORT';
  return plan.flatMap((entry) => [
    ...entry.removeMembershipWorkspaceIds.map((ws) => [
      mode,
      entry.userId,
      entry.email,
      'MEMBERSHIP_SUPPRIMÉE',
      ws,
    ]),
    ...entry.keptOwnerWorkspaceIds.map((ws) => [
      mode,
      entry.userId,
      entry.email,
      'MEMBERSHIP_OWNER_CONSERVÉE_À_REVOIR',
      ws,
    ]),
    [mode, entry.userId, entry.email, 'SSO_UID_EFFACÉ', ''],
    ...(entry.suspend ? [[mode, entry.userId, entry.email, 'COMPTE_SUSPENDU', '']] : []),
  ]);
}

async function main() {
  const { apply, csvPath } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(buildMariaDbOptions()) });
  try {
    const { plan } = await runGenericSsoCleanup(prisma, { apply });
    const path = writeCsvReport(
      csvPath ?? defaultReportPath('cleanup-generic-sso', apply),
      ['mode', 'userId', 'email', 'action', 'workspaceId'],
      planToCsvRows(plan, apply),
    );
    const owners = plan.reduce((n, e) => n + e.keptOwnerWorkspaceIds.length, 0);
    console.log(`Comptes generic:% : ${plan.length}`);
    console.log(
      `Memberships à retirer : ${plan.reduce((n, e) => n + e.removeMembershipWorkspaceIds.length, 0)}`,
    );
    console.log(`Memberships OWNER conservées (revue manuelle) : ${owners}`);
    console.log(`Comptes à suspendre : ${plan.filter((e) => e.suspend).length}`);
    console.log(`Rapport CSV : ${path}`);
    console.log(
      apply
        ? 'Modifications appliquées.'
        : 'Mode rapport : aucune donnée modifiée. Relancer avec --apply pour appliquer.',
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
