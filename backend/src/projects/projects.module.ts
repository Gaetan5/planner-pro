import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotesModule } from '../notes/notes.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [PrismaModule, NotesModule, TrackingModule],
  providers: [ProjectsService, InvitationsService, CommentsService, AiService],
  controllers: [ProjectsController, InvitationsController, CommentsController, AiController],
})
export class ProjectsModule {}
