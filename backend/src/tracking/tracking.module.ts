import { Module, forwardRef } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { TrackingController } from './tracking.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { FirestoreSyncModule } from '../firestore-sync/firestore-sync.module';

@Module({
  imports: [PrismaModule, forwardRef(() => ProjectsModule), FirestoreSyncModule],
  providers: [TrackingService, TrackingGateway],
  controllers: [TrackingController],
  exports: [TrackingService, TrackingGateway],
})
export class TrackingModule {}
