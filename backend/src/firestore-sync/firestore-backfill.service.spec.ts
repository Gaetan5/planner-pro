import { Test, TestingModule } from '@nestjs/testing';
import { FirestoreBackfillService } from './firestore-backfill.service';
import { PrismaService } from '../prisma/prisma.service';
import { FirestoreSyncService } from './firestore-sync.service';

describe('FirestoreBackfillService', () => {
  let service: FirestoreBackfillService;

  const mockPrisma = {
    project: {
      findMany: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
  };

  interface MockDocRef {
    get: jest.Mock;
    collection: jest.Mock;
  }

  interface MockCollectionRef {
    doc: jest.Mock;
    collection: jest.Mock;
  }

  const mockDocSnapshot = {
    exists: true,
    get: jest.fn(),
  };

  const mockDocRef: MockDocRef = {
    get: jest.fn().mockResolvedValue(mockDocSnapshot),
    collection: jest.fn(),
  };

  const mockCollection: MockCollectionRef = {
    doc: jest.fn().mockReturnValue(mockDocRef),
    collection: jest.fn(),
  };

  mockDocRef.collection.mockReturnValue(mockCollection);
  mockCollection.collection.mockReturnValue(mockCollection);

  const mockFirestore = {
    collection: jest.fn().mockReturnValue(mockCollection),
    runTransaction: jest.fn(),
  };

  const mockFirestoreSync = {
    getFirestore: jest.fn(),
    isSyncEnabled: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirestoreBackfillService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FirestoreSyncService, useValue: mockFirestoreSync },
      ],
    }).compile();

    service = module.get<FirestoreBackfillService>(FirestoreBackfillService);
  });

  describe('auditConsistency', () => {
    it('devrait indiquer FIRESTORE_DISABLED si la synchro est inactive', async () => {
      mockFirestoreSync.isSyncEnabled.mockReturnValue(false);
      mockFirestoreSync.getFirestore.mockReturnValue(undefined);
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1', workspaceId: 'ws1' }]);
      mockPrisma.task.findMany.mockResolvedValue([]);

      const audit = await service.auditConsistency();

      expect(audit.summary).toBe('FIRESTORE_DISABLED');
      expect(audit.counts['project'].mysql).toBe(1);
      expect(audit.counts['project'].firestore).toBe(0);
      expect(audit.counts['project'].missingInFirestore).toBe(1);
    });

    it('devrait détecter les documents manquants et retourner DIVERGENCES_DETECTED', async () => {
      mockFirestoreSync.isSyncEnabled.mockReturnValue(true);
      mockFirestoreSync.getFirestore.mockReturnValue(mockFirestore);

      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1', workspaceId: 'ws1' }]);
      mockPrisma.task.findMany.mockResolvedValue([
        { id: 't1', projectId: 'p1', project: { workspaceId: 'ws1' } },
      ]);

      // p1 existe dans Firestore mais t1 est manquant
      mockDocRef.get
        .mockResolvedValueOnce({ exists: true, get: () => false }) // p1 présent
        .mockResolvedValueOnce({ exists: false, get: () => undefined }); // t1 manquant

      const audit = await service.auditConsistency();

      expect(audit.summary).toBe('DIVERGENCES_DETECTED');
      expect(audit.counts['project'].missingInFirestore).toBe(0);
      expect(audit.counts['task'].missingInFirestore).toBe(1);
      expect(audit.missingDetails).toEqual([
        { entityType: 'task', entityId: 't1', workspaceId: 'ws1' },
      ]);
    });

    it('devrait retourner IN_SYNC quand tous les documents sont présents', async () => {
      mockFirestoreSync.isSyncEnabled.mockReturnValue(true);
      mockFirestoreSync.getFirestore.mockReturnValue(mockFirestore);

      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1', workspaceId: 'ws1' }]);
      mockPrisma.task.findMany.mockResolvedValue([]);

      mockDocRef.get.mockResolvedValueOnce({ exists: true, get: () => false });

      const audit = await service.auditConsistency();

      expect(audit.summary).toBe('IN_SYNC');
      expect(audit.missingDetails).toHaveLength(0);
    });
  });

  describe('backfill', () => {
    it('devrait effectuer une simulation en dryRun sans écriture Firestore', async () => {
      mockFirestoreSync.getFirestore.mockReturnValue(mockFirestore);
      mockPrisma.project.findMany.mockResolvedValueOnce([
        { id: 'p1', name: 'Projet 1', workspaceId: 'ws1', userId: 'u1' },
      ]);
      mockPrisma.task.findMany.mockResolvedValueOnce([]);

      const result = await service.backfill({ dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.totalProcessed).toBe(1);
      expect(result.migrated).toBe(1);
      expect(mockFirestore.runTransaction).not.toHaveBeenCalled();
    });

    it('devrait ignorer un document si syncSequence > 0 (déjà plus frais dans Firestore)', async () => {
      mockFirestoreSync.getFirestore.mockReturnValue(mockFirestore);
      mockPrisma.project.findMany.mockResolvedValueOnce([
        {
          id: 'p1',
          name: 'P1',
          description: 'Desc',
          status: 'ACTIVE',
          workspaceId: 'ws1',
          userId: 'u1',
          budgetCents: 1000,
          billingType: 'FIXED_PRICE',
          startDate: null,
          dueDate: null,
        },
      ]);
      mockPrisma.task.findMany.mockResolvedValueOnce([]);

      mockFirestore.runTransaction.mockImplementation(async (cb) => {
        const transaction = {
          get: jest.fn().mockResolvedValue({ get: () => 5 }), // seq = 5 > 0
          set: jest.fn(),
        };
        await cb(transaction);
        expect(transaction.set).not.toHaveBeenCalled();
      });

      const result = await service.backfill({ dryRun: false });

      expect(result.totalProcessed).toBe(1);
      expect(result.skippedAlreadyFresh).toBe(1);
      expect(result.migrated).toBe(0);
    });

    it('devrait migrer et écrire le document avec syncSequence: 0 si absent ou seq = 0', async () => {
      mockFirestoreSync.getFirestore.mockReturnValue(mockFirestore);
      mockPrisma.project.findMany.mockResolvedValueOnce([
        {
          id: 'p1',
          name: 'P1',
          description: 'Desc',
          status: 'ACTIVE',
          workspaceId: 'ws1',
          userId: 'u1',
          budgetCents: 1000,
          billingType: 'FIXED_PRICE',
          startDate: new Date('2026-01-01'),
          dueDate: null,
        },
      ]);
      mockPrisma.task.findMany.mockResolvedValueOnce([]);

      mockFirestore.runTransaction.mockImplementation(async (cb) => {
        const transaction = {
          get: jest.fn().mockResolvedValue({ get: () => undefined }), // pas de seq
          set: jest.fn(),
        };
        await cb(transaction);
        expect(transaction.set).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            id: 'p1',
            name: 'P1',
            syncSequence: 0,
            backfilled: true,
          }),
          { merge: true },
        );
      });

      const result = await service.backfill({ dryRun: false });

      expect(result.totalProcessed).toBe(1);
      expect(result.migrated).toBe(1);
      expect(result.skippedAlreadyFresh).toBe(0);
    });
  });
});
