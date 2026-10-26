import { Logger } from '@nestjs/common';
import { FirestoreSyncService } from './firestore-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import type { Firestore } from 'firebase-admin/firestore';

describe('FirestoreSyncService', () => {
  it('does not enqueue events when the mirror is disabled', async () => {
    const create = jest.fn();
    const prisma = {
      firestoreSyncOutbox: { create },
    } as unknown as PrismaService;
    const service = new FirestoreSyncService(prisma);

    await service.enqueue({} as Prisma.TransactionClient, {
      entityType: 'project',
      entityId: 'project-1',
      workspaceId: 'workspace-1',
      operation: 'upsert',
      payload: { id: 'project-1' },
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('does not query or initialize Firestore when disabled', async () => {
    const prisma = {
      firestoreSyncOutbox: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const service = new FirestoreSyncService(prisma);

    await service.processPendingEvents();

    expect(prisma.firestoreSyncOutbox.findMany).not.toHaveBeenCalled();
  });

  it('writes the newest project snapshot and marks its outbox event processed', async () => {
    const event = {
      id: 'event-1',
      sequence: 12,
      entityType: 'project',
      entityId: 'project-1',
      workspaceId: 'workspace-1',
      operation: 'upsert',
      payload: { id: 'project-1', name: 'Roadmap' },
      attempts: 0,
    };
    const transactionSet = jest.fn();
    const firestore = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnThis(),
      runTransaction: jest.fn(async (callback) =>
        callback({ get: jest.fn().mockResolvedValue({ get: () => 0 }), set: transactionSet }),
      ),
    };
    const prisma = {
      firestoreSyncOutbox: {
        findMany: jest.fn().mockResolvedValue([{ id: event.id }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(event),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as PrismaService;
    const service = new FirestoreSyncService(prisma);
    Object.defineProperty(service, 'syncEnabled', { value: true });
    Object.defineProperty(service, 'firestore', { value: firestore as unknown as Firestore });

    await service.processPendingEvents();

    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(transactionSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: event.entityId,
        name: 'Roadmap',
        syncSequence: event.sequence,
        syncDeleted: false,
      }),
    );
    expect(prisma.firestoreSyncOutbox.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: expect.objectContaining({
        processedAt: expect.any(Date),
        claimedAt: null,
        lastError: null,
      }),
    });
  });

  it('schedules a retry and records the error when Firestore fails', async () => {
    const event = {
      id: 'event-failed',
      sequence: 4,
      entityType: 'project',
      entityId: 'project-1',
      workspaceId: 'workspace-1',
      operation: 'upsert',
      payload: { id: 'project-1' },
      attempts: 0,
    };
    const prisma = {
      firestoreSyncOutbox: {
        findMany: jest.fn().mockResolvedValue([{ id: event.id }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(event),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as PrismaService;
    const firestore = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnThis(),
      runTransaction: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
    };
    const service = new FirestoreSyncService(prisma);
    Object.defineProperty(service, 'syncEnabled', { value: true });
    Object.defineProperty(service, 'firestore', { value: firestore as unknown as Firestore });
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await service.processPendingEvents();

    expect(prisma.firestoreSyncOutbox.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: expect.objectContaining({
        attempts: 1,
        nextAttemptAt: expect.any(Date),
        claimedAt: null,
        lastError: 'Firestore unavailable',
      }),
    });
    jest.restoreAllMocks();
  });

  it('does not overwrite a Firestore document with an older event sequence', async () => {
    const event = {
      id: 'event-stale',
      sequence: 6,
      entityType: 'project',
      entityId: 'project-1',
      workspaceId: 'workspace-1',
      operation: 'upsert',
      payload: { id: 'project-1', name: 'Stale name' },
      attempts: 0,
    };
    const transactionSet = jest.fn();
    const prisma = {
      firestoreSyncOutbox: {
        findMany: jest.fn().mockResolvedValue([{ id: event.id }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(event),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as PrismaService;
    const firestore = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnThis(),
      runTransaction: jest.fn(async (callback) =>
        callback({ get: jest.fn().mockResolvedValue({ get: () => 10 }), set: transactionSet }),
      ),
    };
    const service = new FirestoreSyncService(prisma);
    Object.defineProperty(service, 'syncEnabled', { value: true });
    Object.defineProperty(service, 'firestore', { value: firestore as unknown as Firestore });

    await service.processPendingEvents();

    expect(transactionSet).not.toHaveBeenCalled();
    expect(prisma.firestoreSyncOutbox.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: expect.objectContaining({ processedAt: expect.any(Date) }),
    });
  });

  it('purges processed events older than retention cutoff', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 5 });
    const prisma = {
      firestoreSyncOutbox: { deleteMany },
    } as unknown as PrismaService;
    const service = new FirestoreSyncService(prisma);

    const purged = await service.cleanupProcessedEvents(7);

    expect(purged).toBe(5);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        processedAt: {
          not: null,
          lt: expect.any(Date),
        },
      },
    });
  });
});
