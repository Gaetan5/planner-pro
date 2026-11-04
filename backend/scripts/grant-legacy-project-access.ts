/**
 * Reprise P4 (audit S12) : accorde un rôle de projet aux membres existants qui n'en ont aucun.
 *
 * Depuis S12-a, un MEMBER ou un VIEWER du workspace n'a plus aucun accès à un projet sans
 * `ProjectMembership` (règle stricte, aucun accès implicite). Ce script préserve les accès
 * d'avant le correctif, sur décision de l'utilisateur (voir docs/security/runbook-phase3.md § 5).
 *
 * À EXÉCUTER MANUELLEMENT, après sauvegarde, jamais depuis la CI :
 *   cd backend
 *   npx tsx --env-file=.env scripts/grant-legacy-project-access.ts          # rapport seul (aucune écriture)
 *   npx tsx --env-file=.env scripts/grant-legacy-project-access.ts --apply  # application, en transaction
 *   Option : --csv=<chemin> (défaut : reprise-phase0/grant-legacy-project-access-<mode>-<date>.csv)
 *
 * Règles :
 *  - MEMBER du workspace -> CONTRIBUTOR ; VIEWER du workspace -> CLIENT (lecture seule).
 *    OWNER et ADMIN sont MANAGER implicites : ils ne sont pas concernés.
 *  - Seuls les comptes ayant une `Membership` dans le workspace du projet sont traités (un compte
 *    désactivé par SCIM n'en a plus : ignoré), sur les projets non supprimés de workspaces non supprimés.
 *  - Le créateur d'un projet n'est pas concerné (il est reconnu par `project.userId`, sans
 *    `ProjectMembership`), comme dans la requête SQL du runbook § 2.
 *  - Un utilisateur qui a déjà une `ProjectMembership` (quel que soit son rôle) sur le projet n'est
 *    jamais modifié. Le script est idempotent : une seconde exécution ne trouve plus rien à accorder.
 *  - Le CSV ne contient que des identifiants (aucune adresse e-mail).
 */
import { PrismaClient, ProjectRole, WorkspaceRole } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { buildMariaDbOptions } from '../src/prisma/prisma.service';
import { defaultReportPath, parseArgs, writeCsvReport } from './lib/csv';

const ROLE_MAPPING: Partial<Record<WorkspaceRole, ProjectRole>> = {
  MEMBER: 'CONTRIBUTOR',
  VIEWER: 'CLIENT',
};

export interface LegacyMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export interface LegacyGrant {
  workspaceId: string;
  projectId: string;
  userId: string;
  workspaceRole: WorkspaceRole;
  projectRole: ProjectRole;
}

/** Calcul pur : les accès à accorder, sans doublon et sans toucher aux rôles existants. */
export function planLegacyGrants(
  memberships: LegacyMembership[],
  projects: Array<{ id: string; workspaceId: string; userId?: string | null }>,
  existing: Array<{ projectId: string; userId: string }>,
): LegacyGrant[] {
  const already = new Set(existing.map((e) => `${e.projectId}:${e.userId}`));
  const grants: LegacyGrant[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    for (const m of memberships) {
      const projectRole = ROLE_MAPPING[m.role];
      if (!projectRole || m.workspaceId !== project.workspaceId) continue;
      if (project.userId && project.userId === m.userId) continue;
      const key = `${project.id}:${m.userId}`;
      if (already.has(key) || seen.has(key)) continue;
      seen.add(key);
      grants.push({
        workspaceId: m.workspaceId,
        projectId: project.id,
        userId: m.userId,
        workspaceRole: m.role,
        projectRole,
      });
    }
  }
  return grants;
}

export const GRANT_CSV_HEADERS = [
  'mode',
  'workspaceId',
  'projectId',
  'userId',
  'roleWorkspace',
  'roleProjetAccordé',
];

/** Lignes du rapport : identifiants et rôles seulement, jamais d'adresse e-mail. */
export function grantsToCsvRows(grants: LegacyGrant[], mode: string): string[][] {
  return grants.map((g) => [
    mode,
    g.workspaceId,
    g.projectId,
    g.userId,
    g.workspaceRole,
    g.projectRole,
  ]);
}

export async function runLegacyProjectAccessGrant(
  prisma: PrismaClient,
  { apply }: { apply: boolean },
): Promise<{ grants: LegacyGrant[]; created: number }> {
  const memberships = await prisma.membership.findMany({
    where: { role: { in: ['MEMBER', 'VIEWER'] }, workspace: { deletedAt: null } },
    select: { workspaceId: true, userId: true, role: true },
  });
  const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
  const projects =
    workspaceIds.length > 0
      ? await prisma.project.findMany({
          where: { workspaceId: { in: workspaceIds }, deletedAt: null },
          select: { id: true, workspaceId: true, userId: true },
        })
      : [];
  const scoped = projects.flatMap((p) =>
    p.workspaceId ? [{ id: p.id, workspaceId: p.workspaceId, userId: p.userId }] : [],
  );
  const existing =
    scoped.length > 0
      ? await prisma.projectMembership.findMany({
          where: { projectId: { in: scoped.map((p) => p.id) } },
          select: { projectId: true, userId: true },
        })
      : [];
  const grants = planLegacyGrants(memberships, scoped, existing);

  let created = 0;
  if (apply && grants.length > 0) {
    // Délai allongé : sur une grosse base, le défaut de 5 s ferait échouer (rollback) la transaction
    await prisma.$transaction(
      async (tx) => {
        // skipDuplicates : sans effet si l'accès a été accordé entre-temps (idempotence, concurrence)
        const result = await tx.projectMembership.createMany({
          data: grants.map((g) => ({
            projectId: g.projectId,
            userId: g.userId,
            role: g.projectRole,
          })),
          skipDuplicates: true,
        });
        created = result.count;
      },
      { timeout: 120_000 },
    );
  }
  return { grants, created };
}

async function main() {
  const { apply, csvPath } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(buildMariaDbOptions()) });

  try {
    const result = await runLegacyProjectAccessGrant(prisma, { apply });
    const mode = apply ? 'APPLIQUÉ' : 'RAPPORT';
    const path = writeCsvReport(
      csvPath ?? defaultReportPath('grant-legacy-project-access', apply),
      GRANT_CSV_HEADERS,
      grantsToCsvRows(result.grants, mode),
    );
    console.log(`Accès de projet à accorder : ${result.grants.length}`);
    console.log(`Rapport CSV : ${path}`);
    console.log(
      apply
        ? `Modifications appliquées : ${result.created} accès créés.`
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
