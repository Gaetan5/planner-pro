import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotesModule } from '../notes/notes.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [PrismaModule, NotesModule, TrackingModule],
  providers: [ProjectsService, InvitationsService],
  controllers: [ProjectsController, InvitationsController],
})
export class ProjectsModule {}
