import { Module } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { TrackingController } from './tracking.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [PrismaModule, ProjectsModule],
  providers: [TrackingService, TrackingGateway],
  controllers: [TrackingController],
  exports: [TrackingService, TrackingGateway],
})
export class TrackingModule {}
