import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { CopilotService } from './copilot.service';
import { IntegrationService } from './integration.service';
import { CalendarSyncService } from './calendar-sync.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotesModule } from '../notes/notes.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [PrismaModule, NotesModule, TrackingModule],
  providers: [
    ProjectsService,
    InvitationsService,
    CommentsService,
    AiService,
    CopilotService,
    IntegrationService,
    CalendarSyncService,
  ],
  controllers: [ProjectsController, InvitationsController, CommentsController, AiController],
  exports: [ProjectsService, CopilotService, IntegrationService, CalendarSyncService],
})
export class ProjectsModule {}
