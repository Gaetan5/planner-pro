/**
 * Nettoyage des données produites par l'ancien simulateur de calendrier (audit S5, S28).
 *
 * À EXÉCUTER MANUELLEMENT, après sauvegarde (voir docs/security/runbook-reprise-phase0.md) :
 *   cd backend
 *   npx tsx --env-file=.env scripts/cleanup-simulated-calendar.ts          # rapport seul (aucune écriture)
 *   npx tsx --env-file=.env scripts/cleanup-simulated-calendar.ts --apply  # application, en transaction
 *   Option : --csv=<chemin> (défaut : reprise-phase0/cleanup-simulated-calendar-<mode>-<date>.csv)
 *
 * Variables requises : DATABASE_URL, ENCRYPTION_KEY (et NODE_ENV/DATABASE_SSL comme pour l'API).
 *
 * Ce que le script traite :
 *  1. Les intégrations dont le jeton d'accès ou de rafraîchissement déchiffré commence par `mock-`
 *     (jetons factices persistés hors production) : supprimées.
 *  2. Les TimeBlocks des tâches « Synchronisation Calendrier » dont le créneau correspond aux motifs
 *     du simulateur (10:00-12:00 ou 14:00-16:00 UTC, durée exacte de 2 h) : supprimés.
 *     Un import réel peut coïncider avec ces motifs : relire le rapport avant `--apply`.
 *  3. Les tâches « Synchronisation Calendrier » dont le propriétaire n'est pas membre du workspace
 *     du projet (créées avec `user.findFirst()`) : réattribuées au propriétaire du workspace.
 * Idempotent : une seconde exécution ne trouve plus rien à modifier.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { buildMariaDbOptions } from '../src/prisma/prisma.service';
import { decrypt } from '../src/auth/encryption.util';
import { defaultReportPath, parseArgs, writeCsvReport } from './lib/csv';

const SYNC_TASK_TITLE = 'Synchronisation Calendrier';
const SIMULATED_SLOTS_UTC = [
  { startHour: 10, endHour: 12 },
  { startHour: 14, endHour: 16 },
];

export interface SyncTaskOwnership {
  taskId: string;
  workspaceId: string;
  ownerId: string;
  userId: string;
  userIsMember: boolean;
}

export interface SyncTaskReassignment {
  taskId: string;
  workspaceId: string;
  oldUserId: string;
  newUserId: string;
}

export function isSimulatedSlot(start: Date, end: Date): boolean {
  const exactHour = (d: Date) =>
    d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (!exactHour(start) || !exactHour(end)) return false;
  if (end.getTime() - start.getTime() !== 2 * 60 * 60 * 1000) return false;
  return SIMULATED_SLOTS_UTC.some(
    (slot) => start.getUTCHours() === slot.startHour && end.getUTCHours() === slot.endHour,
  );
}

function isMockToken(cipherText: string | null): boolean {
  if (!cipherText) return false;
  try {
    return decrypt(cipherText).startsWith('mock-');
  } catch {
    return false;
  }
}

/**
 * Une tâche de synchronisation possédée par un non-membre du workspace n'est jamais légitime :
 * elle est réattribuée au propriétaire du workspace. Les autres ne sont pas modifiées.
 */
export function planSyncTaskReassignments(tasks: SyncTaskOwnership[]): SyncTaskReassignment[] {
  return tasks
    .filter((t) => !t.userIsMember && t.userId !== t.ownerId)
    .map((t) => ({
      taskId: t.taskId,
      workspaceId: t.workspaceId,
      oldUserId: t.userId,
      newUserId: t.ownerId,
    }));
}

export async function runSimulatedCalendarCleanup(
  prisma: PrismaClient,
  { apply }: { apply: boolean },
): Promise<{
  mockIntegrations: Array<{ id: string; workspaceId: string; name: string }>;
  simulatedBlockIds: string[];
  reassignments: SyncTaskReassignment[];
}> {
  // 1. Intégrations à jetons factices
  const calendarIntegrations = await prisma.integration.findMany({
    where: { type: { in: ['GOOGLE_CALENDAR', 'OUTLOOK'] } },
    select: { id: true, workspaceId: true, name: true, accessToken: true, refreshToken: true },
  });
  const mockIntegrations = calendarIntegrations
    .filter((i) => isMockToken(i.accessToken) || isMockToken(i.refreshToken))
    .map(({ id, workspaceId, name }) => ({ id, workspaceId, name }));

  // 2. Créneaux simulés importés dans les tâches de synchronisation
  const syncTasks = await prisma.task.findMany({
    where: { title: SYNC_TASK_TITLE },
    select: {
      id: true,
      userId: true,
      project: { select: { workspaceId: true, workspace: { select: { ownerId: true } } } },
      timeBlocks: { select: { id: true, startTime: true, endTime: true } },
    },
  });
  const simulatedBlockIds = syncTasks.flatMap((task) =>
    task.timeBlocks
      .filter((block) => isSimulatedSlot(new Date(block.startTime), new Date(block.endTime)))
      .map((block) => block.id),
  );

  // 3. Propriétaires des tâches de synchronisation : membres ou non du workspace
  const ownedTasks = syncTasks.flatMap((t) =>
    t.userId && t.project.workspaceId && t.project.workspace
      ? [
          {
            taskId: t.id,
            userId: t.userId,
            workspaceId: t.project.workspaceId,
            ownerId: t.project.workspace.ownerId,
          },
        ]
      : [],
  );
  const memberships =
    ownedTasks.length > 0
      ? await prisma.membership.findMany({
          where: { OR: ownedTasks.map((t) => ({ workspaceId: t.workspaceId, userId: t.userId })) },
          select: { workspaceId: true, userId: true },
        })
      : [];
  const memberKeys = new Set(memberships.map((m) => `${m.workspaceId}:${m.userId}`));
  const reassignments = planSyncTaskReassignments(
    ownedTasks.map((t) => ({
      ...t,
      userIsMember: memberKeys.has(`${t.workspaceId}:${t.userId}`),
    })),
  );

  if (apply) {
    await prisma.$transaction(async (tx) => {
      if (simulatedBlockIds.length > 0) {
        await tx.timeBlock.deleteMany({ where: { id: { in: simulatedBlockIds } } });
      }
      if (mockIntegrations.length > 0) {
        await tx.integration.deleteMany({
          where: { id: { in: mockIntegrations.map((i) => i.id) } },
        });
      }
      for (const r of reassignments) {
        // Conditionnel sur l'ancien propriétaire : sans effet si la tâche a changé entre-temps
        await tx.task.updateMany({
          where: { id: r.taskId, userId: r.oldUserId },
          data: { userId: r.newUserId },
        });
      }
    });
  }

  return { mockIntegrations, simulatedBlockIds, reassignments };
}

async function main() {
  const { apply, csvPath } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(buildMariaDbOptions()) });

  try {
    const result = await runSimulatedCalendarCleanup(prisma, { apply });
    const mode = apply ? 'APPLIQUÉ' : 'RAPPORT';
    const path = writeCsvReport(
      csvPath ?? defaultReportPath('cleanup-simulated-calendar', apply),
      ['mode', 'action', 'taskId', 'workspaceId', 'oldUserId', 'newUserId', 'objetId'],
      [
        ...result.reassignments.map((r) => [
          mode,
          'TÂCHE_RÉATTRIBUÉE',
          r.taskId,
          r.workspaceId,
          r.oldUserId,
          r.newUserId,
          '',
        ]),
        ...result.mockIntegrations.map((i) => [
          mode,
          'INTÉGRATION_MOCK_SUPPRIMÉE',
          '',
          i.workspaceId,
          '',
          '',
          i.id,
        ]),
        ...result.simulatedBlockIds.map((id) => [
          mode,
          'CRÉNEAU_SIMULÉ_SUPPRIMÉ',
          '',
          '',
          '',
          '',
          id,
        ]),
      ],
    );

    console.log(`Intégrations à jetons factices (mock-*) : ${result.mockIntegrations.length}`);
    console.log(
      `Créneaux simulés dans « ${SYNC_TASK_TITLE} » : ${result.simulatedBlockIds.length}`,
    );
    console.log(
      `Tâches « ${SYNC_TASK_TITLE} » à réattribuer au propriétaire du workspace : ${result.reassignments.length}`,
    );
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
