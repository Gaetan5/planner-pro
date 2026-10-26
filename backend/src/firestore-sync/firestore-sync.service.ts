import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { cert, deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { PrismaService } from '../prisma/prisma.service';

type SyncedEntityType =
  | 'project'
  | 'task'
  | 'taskDependency'
  | 'timeBlock'
  | 'timeLog'
  | 'note'
  | 'comment'
  | 'attachment'
  | 'milestone'
  | 'deliverable'
  | 'deliveryRecord'
  | 'deliveryChecklistItem'
  | 'sprint'
  | 'resourceProfile'
  | 'resourceAllocation'
  | 'resourceLeave'
  | 'notification'
  | 'invitation'
  | 'team'
  | 'membership'
  | 'projectMembership'
  | 'projectPhaseItem'
  | 'integration';
type SyncOperation = 'upsert' | 'delete';

interface SyncPayload {
  [key: string]: string | number | boolean | null | string[];
}

interface SyncEvent {
  entityType: SyncedEntityType;
  entityId: string;
  workspaceId: string;
  operation: SyncOperation;
  payload: SyncPayload;
}

interface OutboxEvent {
  id: string;
  sequence: number;
  entityType: string;
  entityId: string;
  workspaceId: string;
  operation: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

const LEASE_TIMEOUT_MS = 60_000;
const BATCH_SIZE = 25;

@Injectable()
export class FirestoreSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirestoreSyncService.name);
  private firestore?: Firestore;
  private firebaseApp?: App;
  private processing = false;
  private syncEnabled = false;

  constructor(private readonly prisma: PrismaService) {}

  getFirestore(): Firestore | undefined {
    return this.firestore;
  }

  isSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  async getStatus() {
    if (!this.syncEnabled || !this.firestore) {
      return {
        state: 'disabled' as const,
        pendingEvents: null,
        retryingEvents: null,
        deadLetterEvents: null,
        oldestPendingAt: null,
        oldestAgeMinutes: null,
      };
    }

    const [pendingEvents, retryingEvents, deadLetterEvents, oldestPending] = await Promise.all([
      this.prisma.firestoreSyncOutbox.count({ where: { processedAt: null } }),
      this.prisma.firestoreSyncOutbox.count({
        where: { processedAt: null, attempts: { gt: 0 } },
      }),
      this.prisma.firestoreSyncOutbox.count({
        where: { processedAt: null, attempts: { gte: 10 } },
      }),
      this.prisma.firestoreSyncOutbox.findFirst({
        where: { processedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const oldestAgeMinutes = oldestPending
      ? Math.max(0, Math.floor((Date.now() - oldestPending.createdAt.getTime()) / 60000))
      : null;

    return {
      state: 'active' as const,
      pendingEvents,
      retryingEvents,
      deadLetterEvents,
      oldestPendingAt: oldestPending?.createdAt.toISOString() ?? null,
      oldestAgeMinutes,
    };
  }

  @Cron('0 2 * * *')
  async cleanupProcessedEvents(
    retentionDays = Number(process.env.FIRESTORE_SYNC_RETENTION_DAYS ?? '7'),
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.firestoreSyncOutbox.deleteMany({
      where: {
        processedAt: { not: null, lt: cutoff },
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Purged ${result.count} processed Firestore sync outbox events older than ${retentionDays} days.`,
      );
    }
    return result.count;
  }

  async onModuleInit(): Promise<void> {
    this.syncEnabled = process.env.FIRESTORE_SYNC_ENABLED === 'true';
    if (!this.syncEnabled) return;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firestore sync is enabled but Firebase Admin credentials are incomplete.');
    }

    const appName = 'planner-pro-firestore-sync';
    this.firebaseApp =
      getApps().find((registeredApp) => registeredApp.name === appName) ??
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, appName);
    this.firestore = getFirestore(this.firebaseApp);
    await this.firestore.listCollections();
    this.logger.log('Firestore mirror is enabled; MySQL remains authoritative during rollout.');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.firebaseApp && getApps().some((app) => app.name === this.firebaseApp?.name)) {
      await deleteApp(this.firebaseApp);
    }
  }

  async enqueue(tx: Prisma.TransactionClient, event: SyncEvent): Promise<void> {
    if (!this.syncEnabled) return;
    await tx.firestoreSyncOutbox.create({
      data: {
        entityType: event.entityType,
        entityId: event.entityId,
        workspaceId: event.workspaceId,
        operation: event.operation,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }

  @Cron('*/10 * * * * *')
  async processPendingEvents(): Promise<void> {
    if (!this.syncEnabled || !this.firestore || this.processing) return;
    this.processing = true;

    try {
      await this.processBatch();
    } catch (error) {
      this.logger.error(
        'Firestore outbox processing failed.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.processing = false;
    }
  }

  private async processBatch(): Promise<void> {
    const now = new Date();
    const staleLease = new Date(now.getTime() - LEASE_TIMEOUT_MS);
    const candidates = await this.prisma.firestoreSyncOutbox.findMany({
      where: {
        processedAt: null,
        nextAttemptAt: { lte: now },
        OR: [{ claimedAt: null }, { claimedAt: { lt: staleLease } }],
      },
      orderBy: { sequence: 'asc' },
      take: BATCH_SIZE,
      select: { id: true },
    });

    for (const candidate of candidates) {
      const claim = await this.prisma.firestoreSyncOutbox.updateMany({
        where: {
          id: candidate.id,
          processedAt: null,
          nextAttemptAt: { lte: now },
          OR: [{ claimedAt: null }, { claimedAt: { lt: staleLease } }],
        },
        data: { claimedAt: now },
      });
      if (claim.count !== 1) continue;

      const event = await this.prisma.firestoreSyncOutbox.findUnique({
        where: { id: candidate.id },
      });
      if (!event) continue;

      try {
        await this.applyEvent(event);
        await this.prisma.firestoreSyncOutbox.update({
          where: { id: event.id },
          data: { processedAt: new Date(), claimedAt: null, lastError: null },
        });
      } catch (error) {
        await this.recordFailure(event, error);
      }
    }
  }

  private async applyEvent(event: OutboxEvent): Promise<void> {
    if (!this.firestore) throw new Error('Firestore client is not initialized.');
    const supportedEntities: SyncedEntityType[] = [
      'project',
      'task',
      'taskDependency',
      'timeBlock',
      'timeLog',
      'note',
      'comment',
      'attachment',
      'milestone',
      'deliverable',
      'deliveryRecord',
      'deliveryChecklistItem',
      'sprint',
      'resourceProfile',
      'resourceAllocation',
      'resourceLeave',
      'notification',
      'invitation',
      'team',
      'membership',
      'projectMembership',
      'projectPhaseItem',
      'integration',
    ];
    if (!supportedEntities.includes(event.entityType as SyncedEntityType)) {
      throw new Error(`Unsupported Firestore mirror entity: ${event.entityType}`);
    }
    if (event.operation !== 'upsert' && event.operation !== 'delete') {
      throw new Error(`Unsupported Firestore mirror operation: ${event.operation}`);
    }

    const workspace = this.firestore.collection('workspaces').doc(event.workspaceId);
    let document;
    if (event.entityType === 'project') {
      document = workspace.collection('projects').doc(event.entityId);
    } else if (event.entityType === 'task') {
      const projectId = this.payloadValue(event.payload, 'projectId');
      if (!projectId) throw new Error('Task sync payload is missing projectId.');
      document = workspace
        .collection('projects')
        .doc(projectId)
        .collection('tasks')
        .doc(event.entityId);
    } else {
      document = workspace.collection('entities').doc(`${event.entityType}:${event.entityId}`);
    }

    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(document);
      const currentSequence = current.get('syncSequence');
      if (typeof currentSequence === 'number' && currentSequence >= event.sequence) return;

      transaction.set(document, {
        ...this.toPlainObject(event.payload),
        syncSequence: event.sequence,
        syncDeleted: event.operation === 'delete',
        syncedAt: new Date().toISOString(),
      });
    });
  }

  private async recordFailure(event: OutboxEvent, error: unknown): Promise<void> {
    const attempts = event.attempts + 1;
    const delayMs = Math.min(1000 * 2 ** Math.min(attempts, 10), 15 * 60 * 1000);
    const message = error instanceof Error ? error.message : 'Unknown Firestore sync error';

    await this.prisma.firestoreSyncOutbox.update({
      where: { id: event.id },
      data: {
        attempts,
        nextAttemptAt: new Date(Date.now() + delayMs),
        claimedAt: null,
        lastError: message.slice(0, 4000),
      },
    });
    this.logger.error(
      `Firestore event ${event.id} failed on attempt ${attempts}; retry scheduled.`,
      error instanceof Error ? error.stack : undefined,
    );
  }

  private payloadValue(payload: Prisma.JsonValue, key: string): string | null {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const value = payload[key];
    return typeof value === 'string' ? value : null;
  }

  private toPlainObject(payload: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Firestore event payload must be a JSON object.');
    }
    return payload as Record<string, Prisma.JsonValue>;
  }
}
