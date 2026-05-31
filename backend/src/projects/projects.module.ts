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
import { SprintService } from './sprint.service';
import { TasksService } from './tasks.service';
import { DependenciesService } from './dependencies.service';
import { TimeBlocksService } from './timeblocks.service';
import { MilestonesService } from './milestones.service';
import { ResourcesService } from './resources.service';
import { FinancesService } from './finances.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotesModule } from '../notes/notes.module';
import { TrackingModule } from '../tracking/tracking.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotesModule, TrackingModule, NotificationsModule],
  providers: [
    // Sous-services spécialisés (SRP)
    TasksService,
    DependenciesService,
    TimeBlocksService,
    MilestonesService,
    ResourcesService,
    FinancesService,
    // Façade d'orchestration
    ProjectsService,
    // Services existants
    InvitationsService,
    CommentsService,
    AiService,
    CopilotService,
    IntegrationService,
    CalendarSyncService,
    SprintService,
  ],
  controllers: [ProjectsController, InvitationsController, CommentsController, AiController],
  exports: [
    ProjectsService,
    TasksService,
    DependenciesService,
    TimeBlocksService,
    MilestonesService,
    ResourcesService,
    FinancesService,
    CopilotService,
    IntegrationService,
    CalendarSyncService,
    SprintService,
  ],
})
export class ProjectsModule {}
