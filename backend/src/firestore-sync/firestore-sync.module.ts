import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FirestoreSyncService } from './firestore-sync.service';
import { FirestoreBackfillService } from './firestore-backfill.service';

@Module({
  imports: [PrismaModule],
  providers: [FirestoreSyncService, FirestoreBackfillService],
  exports: [FirestoreSyncService, FirestoreBackfillService],
})
export class FirestoreSyncModule {}
