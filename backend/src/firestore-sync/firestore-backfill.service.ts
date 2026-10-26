import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FirestoreSyncService } from './firestore-sync.service';
import type { Firestore } from 'firebase-admin/firestore';

export interface ConsistencyAuditResult {
  timestamp: string;
  workspaceId?: string;
  summary: 'IN_SYNC' | 'DIVERGENCES_DETECTED' | 'FIRESTORE_DISABLED';
  counts: {
    [entityType: string]: {
      mysql: number;
      firestore: number;
      missingInFirestore: number;
    };
  };
  missingDetails: Array<{
    entityType: string;
    entityId: string;
    workspaceId: string;
  }>;
}

export interface BackfillOptions {
  workspaceId?: string;
  batchSize?: number;
  delayMs?: number;
  dryRun?: boolean;
}

export interface BackfillResult {
  timestamp: string;
  dryRun: boolean;
  totalProcessed: number;
  migrated: number;
  skippedAlreadyFresh: number;
  errors: number;
  details: {
    [entityType: string]: {
      processed: number;
      migrated: number;
      skipped: number;
    };
  };
}

interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  status: string;
  workspaceId: string | null;
  userId: string;
  budgetCents: number | null;
  billingType: string | null;
  startDate: Date | null;
  dueDate: Date | null;
}

interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  projectId: string | null;
  dueDate: Date | null;
  startDate: Date | null;
  progress: number;
  project: { workspaceId: string | null; userId: string } | null;
  assignees: Array<{ userId: string }>;
}

@Injectable()
export class FirestoreBackfillService {
  private readonly logger = new Logger(FirestoreBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firestoreSync: FirestoreSyncService,
  ) {}

  /**
   * Compare le nombre et les identifiants d'entités entre MySQL et Firestore.
   * Produit un rapport exhaustif de divergences sans exposer de secrets.
   */
  async auditConsistency(workspaceId?: string): Promise<ConsistencyAuditResult> {
    const firestore = this.firestoreSync.getFirestore();
    const isEnabled = this.firestoreSync.isSyncEnabled();

    const result: ConsistencyAuditResult = {
      timestamp: new Date().toISOString(),
      workspaceId,
      summary: !isEnabled || !firestore ? 'FIRESTORE_DISABLED' : 'IN_SYNC',
      counts: {},
      missingDetails: [],
    };

    // 1. Projets
    const projects: Array<{ id: string; workspaceId: string | null; userId: string }> =
      await this.prisma.project.findMany({
        where: {
          deletedAt: null,
          ...(workspaceId ? { workspaceId } : {}),
        },
        select: { id: true, workspaceId: true, userId: true },
      });

    let firestoreProjectCount = 0;
    if (firestore) {
      for (const p of projects) {
        const wsId = p.workspaceId ?? `personal-${p.userId}`;
        const doc = await firestore
          .collection('workspaces')
          .doc(wsId)
          .collection('projects')
          .doc(p.id)
          .get();
        if (doc.exists && !doc.get('syncDeleted')) {
          firestoreProjectCount++;
        } else {
          result.missingDetails.push({
            entityType: 'project',
            entityId: p.id,
            workspaceId: wsId,
          });
        }
      }
    }

    result.counts['project'] = {
      mysql: projects.length,
      firestore: firestoreProjectCount,
      missingInFirestore: projects.length - firestoreProjectCount,
    };

    // 2. Tâches
    const tasks: Array<{
      id: string;
      projectId: string | null;
      project: { workspaceId: string | null; userId: string } | null;
    }> = await this.prisma.task.findMany({
      where: {
        deletedAt: null,
        ...(workspaceId ? { project: { workspaceId } } : {}),
      },
      select: {
        id: true,
        projectId: true,
        project: { select: { workspaceId: true, userId: true } },
      },
    });

    let firestoreTaskCount = 0;
    if (firestore) {
      for (const t of tasks) {
        const wsId = t.project?.workspaceId ?? (t.project ? `personal-${t.project.userId}` : null);
        if (!wsId || !t.projectId) continue;
        const doc = await firestore
          .collection('workspaces')
          .doc(wsId)
          .collection('projects')
          .doc(t.projectId)
          .collection('tasks')
          .doc(t.id)
          .get();
        if (doc.exists && !doc.get('syncDeleted')) {
          firestoreTaskCount++;
        } else {
          result.missingDetails.push({
            entityType: 'task',
            entityId: t.id,
            workspaceId: wsId,
          });
        }
      }
    }

    result.counts['task'] = {
      mysql: tasks.length,
      firestore: firestoreTaskCount,
      missingInFirestore: tasks.length - firestoreTaskCount,
    };

    if (result.missingDetails.length > 0 && isEnabled && firestore) {
      result.summary = 'DIVERGENCES_DETECTED';
    }

    return result;
  }

  /**
   * Effectue la reprise MySQL → Firestore avec pagination, contrôle de débit et idempotence.
   * Ne remplace JAMAIS un document qui a une séquence plus récente (`syncSequence > 0`).
   */
  async backfill(options: BackfillOptions = {}): Promise<BackfillResult> {
    const firestore = this.firestoreSync.getFirestore();
    const dryRun = options.dryRun ?? false;
    const batchSize = Math.min(Math.max(options.batchSize ?? 50, 1), 200);
    const delayMs = options.delayMs ?? 10;

    const result: BackfillResult = {
      timestamp: new Date().toISOString(),
      dryRun,
      totalProcessed: 0,
      migrated: 0,
      skippedAlreadyFresh: 0,
      errors: 0,
      details: {},
    };

    if (!firestore && !dryRun) {
      throw new Error(
        'Impossible de lancer le backfill : Firestore n’est pas configuré ou désactivé.',
      );
    }

    this.logger.log(
      `Démarrage de la reprise MySQL -> Firestore (dryRun=${dryRun}, batchSize=${batchSize}, workspace=${options.workspaceId ?? 'tous'})`,
    );

    // Reprise des projets
    await this.backfillProjects(firestore, options, batchSize, delayMs, result);

    // Reprise des tâches
    await this.backfillTasks(firestore, options, batchSize, delayMs, result);

    this.logger.log(
      `Reprise terminée. Total traité: ${result.totalProcessed}, Migré: ${result.migrated}, Ignoré (déjà frais): ${result.skippedAlreadyFresh}, Erreurs: ${result.errors}`,
    );

    return result;
  }

  private async backfillProjects(
    firestore: Firestore | undefined,
    options: BackfillOptions,
    batchSize: number,
    delayMs: number,
    result: BackfillResult,
  ): Promise<void> {
    result.details['project'] = { processed: 0, migrated: 0, skipped: 0 };
    let cursor: string | undefined = undefined;

    while (true) {
      const projects: ProjectRecord[] = await this.prisma.project.findMany({
        where: {
          deletedAt: null,
          ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        },
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
      });

      if (projects.length === 0) {
        break;
      }

      for (const p of projects) {
        result.totalProcessed++;
        result.details['project'].processed++;

        if (options.dryRun || !firestore) {
          result.migrated++;
          result.details['project'].migrated++;
          continue;
        }

        try {
          const wsId = p.workspaceId ?? `personal-${p.userId}`;
          const docRef = firestore
            .collection('workspaces')
            .doc(wsId)
            .collection('projects')
            .doc(p.id);

          await firestore.runTransaction(async (t) => {
            const snap = await t.get(docRef);
            const seq = snap.get('syncSequence');
            // Si le document existe déjà avec un syncSequence issu de l'outbox, on le préserve
            if (typeof seq === 'number' && seq > 0) {
              result.skippedAlreadyFresh++;
              result.details['project'].skipped++;
              return;
            }

            t.set(
              docRef,
              {
                id: p.id,
                name: p.name,
                description: p.description,
                status: p.status,
                workspaceId: wsId,
                budgetCents: p.budgetCents,
                billingType: p.billingType,
                startDate: p.startDate ? p.startDate.toISOString() : null,
                dueDate: p.dueDate ? p.dueDate.toISOString() : null,
                syncSequence: 0,
                syncDeleted: false,
                syncedAt: new Date().toISOString(),
                backfilled: true,
              },
              { merge: true },
            );
            result.migrated++;
            result.details['project'].migrated++;
          });
        } catch (err) {
          result.errors++;
          this.logger.error(`Erreur lors du backfill du projet ${p.id}`, err);
        }
      }

      cursor = projects[projects.length - 1].id;
      if (projects.length < batchSize) {
        break;
      } else if (delayMs > 0) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }

  private async backfillTasks(
    firestore: Firestore | undefined,
    options: BackfillOptions,
    batchSize: number,
    delayMs: number,
    result: BackfillResult,
  ): Promise<void> {
    result.details['task'] = { processed: 0, migrated: 0, skipped: 0 };
    let cursor: string | undefined = undefined;

    while (true) {
      const tasks: TaskRecord[] = await this.prisma.task.findMany({
        where: {
          deletedAt: null,
          ...(options.workspaceId ? { project: { workspaceId: options.workspaceId } } : {}),
        },
        include: {
          project: { select: { workspaceId: true, userId: true } },
          assignees: { select: { userId: true } },
        },
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
      });

      if (tasks.length === 0) {
        break;
      }

      for (const t of tasks) {
        result.totalProcessed++;
        result.details['task'].processed++;

        const wsId = t.project?.workspaceId ?? (t.project ? `personal-${t.project.userId}` : null);
        if (!wsId || !t.projectId) {
          result.skippedAlreadyFresh++;
          result.details['task'].skipped++;
          continue;
        }

        if (options.dryRun || !firestore) {
          result.migrated++;
          result.details['task'].migrated++;
          continue;
        }

        try {
          const docRef = firestore
            .collection('workspaces')
            .doc(wsId)
            .collection('projects')
            .doc(t.projectId)
            .collection('tasks')
            .doc(t.id);

          await firestore.runTransaction(async (transaction) => {
            const snap = await transaction.get(docRef);
            const seq = snap.get('syncSequence');
            if (typeof seq === 'number' && seq > 0) {
              result.skippedAlreadyFresh++;
              result.details['task'].skipped++;
              return;
            }

            transaction.set(
              docRef,
              {
                id: t.id,
                title: t.title,
                description: t.description,
                status: t.status,
                priority: t.priority,
                projectId: t.projectId,
                dueDate: t.dueDate ? t.dueDate.toISOString() : null,
                startDate: t.startDate ? t.startDate.toISOString() : null,
                assigneeIds: t.assignees.map((a: { userId: string }) => a.userId),
                progress: t.progress,
                syncSequence: 0,
                syncDeleted: false,
                syncedAt: new Date().toISOString(),
                backfilled: true,
              },
              { merge: true },
            );
            result.migrated++;
            result.details['task'].migrated++;
          });
        } catch (err) {
          result.errors++;
          this.logger.error(`Erreur lors du backfill de la tâche ${t.id}`, err);
        }
      }

      cursor = tasks[tasks.length - 1].id;
      if (tasks.length < batchSize) {
        break;
      } else if (delayMs > 0) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
}
