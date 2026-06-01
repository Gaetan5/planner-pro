import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Req, Query, Headers } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { DeliverableStatus, ProjectRole } from '@prisma/client';
import { ProjectsService } from './projects.service';
import { SprintService } from './sprint.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { ProjectPermissionsService } from './project-permissions.service';
import { IntegrationService, IntegrationDto } from './integration.service';
import { CalendarSyncService } from './calendar-sync.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTimeBlockDto } from './dto/create-timeblock.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { CreateDeliverableDto } from './dto/create-deliverable.dto';
import { CreateTaskDependencyDto } from './dto/create-task-dependency.dto';
import { UpdateResourceProfileDto } from './dto/update-resource-profile.dto';
import { CreateResourceAllocationDto } from './dto/create-resource-allocation.dto';
import { CreateResourceLeaveDto } from './dto/create-resource-leave.dto';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly sprintService: SprintService,
    private readonly trackingGateway: TrackingGateway,
    private readonly integrationService: IntegrationService,
    private readonly calendarSyncService: CalendarSyncService,
    private readonly projectPermissionsService: ProjectPermissionsService,
  ) {}

  @Get('workspaces')
  getWorkspaces(@Req() req: any) {
    return this.projectsService.getWorkspaces(req.user.id);
  }

  @Get('members')
  getWorkspaceMembers(@Req() req: any) {
    return this.projectsService.getWorkspaceMembers(req.user.id);
  }

  @Get('workspaces/:workspaceId/members')
  getMembersByWorkspace(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    return this.projectsService.getWorkspaceMembers(req.user.id, workspaceId);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PERMISSIONS PROJETS & AUDIT (Lot A)
  // ═══════════════════════════════════════════════════════════════════

  @Get('audit/logs')
  getAuditLogs(@Req() req: any, @Query('limit') limit?: string) {
    return this.projectPermissionsService.getAuditLogs(
      req.user.id,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get(':id/members')
  getProjectMembers(@Req() req: any, @Param('id') projectId: string) {
    return this.projectPermissionsService.getProjectMembers(projectId, req.user.id);
  }

  @Post(':id/members')
  assignProjectRole(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body() body: { targetUserId: string; role: ProjectRole },
  ) {
    return this.projectPermissionsService.assignProjectRole(
      projectId,
      body.targetUserId,
      body.role,
      req.user.id,
    );
  }

  @Delete(':id/members/:userId')
  removeProjectRole(
    @Req() req: any,
    @Param('id') projectId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.projectPermissionsService.removeProjectRole(
      projectId,
      targetUserId,
      req.user.id,
    );
  }

  @Get('timeblocks/all')
  getTimeBlocks(
    @Req() req: any,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    return this.projectsService.getTimeBlocks(
      req.user.id,
      start ? new Date(start) : undefined,
      end ? new Date(end) : undefined,
    );
  }

  @Get('resources/capacity')
  getResourceCapacity(@Req() req: any) {
    return this.projectsService.getResourceCapacityReport(req.user.id);
  }

  @Put('resources/:userId/profile')
  updateResourceProfile(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: UpdateResourceProfileDto,
  ) {
    return this.projectsService.updateResourceProfile(req.user.id, userId, body);
  }

  @Post('resources/:userId/leaves')
  createResourceLeave(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: CreateResourceLeaveDto,
  ) {
    return this.projectsService.createResourceLeave(
      req.user.id,
      userId,
      body.startDate,
      body.endDate,
      body.reason,
    );
  }

  @Get('resources/:userId/leaves')
  getResourceLeaves(@Req() req: any, @Param('userId') userId: string) {
    return this.projectsService.getResourceLeaves(req.user.id, userId);
  }

  @Delete('resources/leaves/:leaveId')
  deleteResourceLeave(@Req() req: any, @Param('leaveId') leaveId: string) {
    return this.projectsService.deleteResourceLeave(req.user.id, leaveId);
  }

  @Post(':id/allocations')
  createResourceAllocation(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body() body: CreateResourceAllocationDto,
  ) {
    return this.projectsService.createResourceAllocation(
      projectId,
      req.user.id,
      body.userId,
      body.allocationPercent,
      body.roleLabel,
      body.startDate,
      body.endDate,
    );
  }

  @Post()
  createProject(@Req() req: any, @Body() body: CreateProjectDto) {
    return this.projectsService.createProject(
      req.user.id,
      body.name,
      body.description,
      body.workspaceId,
      body.status,
      body.startDate,
      body.dueDate,
    );
  }

  @Get()
  getProjects(@Req() req: any) {
    return this.projectsService.getProjects(req.user.id);
  }

  @Get(':id')
  getProject(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.getProject(id, req.user.id);
  }

  @Put(':id')
  updateProject(@Req() req: any, @Param('id') id: string, @Body() body: UpdateProjectDto) {
    return this.projectsService.updateProject(id, req.user.id, body);
  }

  @Delete(':id')
  deleteProject(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.deleteProject(id, req.user.id);
  }

  @Get(':id/delivery-report')
  getDeliveryReport(@Req() req: any, @Param('id') projectId: string) {
    return this.projectsService.getDeliveryReport(projectId, req.user.id);
  }

  @Post(':id/deliveries')
  createDelivery(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body() body: CreateDeliveryDto,
  ) {
    return this.projectsService.createDelivery(projectId, req.user.id, body.summary, body.checklist);
  }

  @Put('deliveries/:deliveryId/status')
  updateDeliveryStatus(
    @Req() req: any,
    @Param('deliveryId') deliveryId: string,
    @Body() body: UpdateDeliveryStatusDto,
  ) {
    return this.projectsService.updateDeliveryStatus(deliveryId, req.user.id, body.status);
  }

  @Put('deliveries/items/:itemId/toggle')
  toggleDeliveryChecklistItem(
    @Req() req: any,
    @Param('itemId') itemId: string,
  ) {
    return this.projectsService.toggleDeliveryChecklistItem(itemId, req.user.id);
  }

  @Post(':id/tasks')
  createTask(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body() body: CreateTaskDto,
  ) {
    const { title, description, priority, ...options } = body;
    return this.projectsService.createTask(projectId, req.user.id, title, description, priority, options);
  }

  @Get(':id/tasks')
  getTasks(@Req() req: any, @Param('id') projectId: string) {
    return this.projectsService.getTasks(projectId, req.user.id);
  }

  @Get(':id/critical-path')
  getCriticalPath(@Req() req: any, @Param('id') projectId: string) {
    return this.projectsService.getCriticalPath(projectId, req.user.id);
  }

  @Post(':id/milestones')
  createMilestone(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body() body: CreateMilestoneDto,
  ) {
    return this.projectsService.createMilestone(projectId, req.user.id, body.name, body.description, body.dueDate);
  }

  @Put('milestones/:milestoneId/complete')
  completeMilestone(@Req() req: any, @Param('milestoneId') milestoneId: string) {
    return this.projectsService.completeMilestone(milestoneId, req.user.id);
  }

  @Post(':id/deliverables')
  createDeliverable(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body() body: CreateDeliverableDto,
  ) {
    return this.projectsService.createDeliverable(
      projectId,
      req.user.id,
      body.title,
      body.description,
      body.status,
      body.dueDate,
    );
  }

  @Put('deliverables/:deliverableId/status/:status')
  updateDeliverableStatus(
    @Req() req: any,
    @Param('deliverableId') deliverableId: string,
    @Param('status') status: DeliverableStatus,
  ) {
    return this.projectsService.updateDeliverableStatus(deliverableId, req.user.id, status);
  }

  @Post('tasks/:taskId/dependencies')
  addTaskDependency(
    @Req() req: any,
    @Param('taskId') taskId: string,
    @Body() body: CreateTaskDependencyDto,
  ) {
    return this.projectsService.addTaskDependency(taskId, req.user.id, body.dependsOnTaskId, body.type);
  }

  @Delete('tasks/:taskId/dependencies/:dependsOnTaskId')
  removeTaskDependency(
    @Req() req: any,
    @Param('taskId') taskId: string,
    @Param('dependsOnTaskId') dependsOnTaskId: string,
  ) {
    return this.projectsService.removeTaskDependency(taskId, req.user.id, dependsOnTaskId);
  }

  @Put('tasks/:taskId')
  async updateTask(
    @Req() req: any,
    @Param('taskId') taskId: string,
    @Body() body: UpdateTaskDto,
  ) {
    const updated = await this.projectsService.updateTask(taskId, req.user.id, body);
    if (this.trackingGateway.server) {
      if (body.status) {
        this.trackingGateway.server.emit('task-status-changed', { taskId });
      }
      const impactedTaskIds = (updated as any).impactedTaskIds;
      if (impactedTaskIds && impactedTaskIds.length > 0) {
        this.trackingGateway.server.emit('task-schedule-propagated', {
          projectId: (updated as any).projectId,
          impactedTaskIds,
        });
        for (const id of impactedTaskIds) {
          this.trackingGateway.server.emit('task-status-changed', { taskId: id });
        }
      }
    }
    return updated;
  }

  @Delete('tasks/:taskId')
  deleteTask(@Req() req: any, @Param('taskId') taskId: string) {
    return this.projectsService.deleteTask(taskId, req.user.id);
  }

  @Post('tasks/:taskId/timeblocks')
  createTimeBlock(
    @Req() req: any,
    @Param('taskId') taskId: string,
    @Body() body: CreateTimeBlockDto,
  ) {
    return this.projectsService.createTimeBlock(taskId, req.user.id, new Date(body.startTime), new Date(body.endTime));
  }

  @Put('timeblocks/:timeBlockId')
  updateTimeBlock(
    @Req() req: any,
    @Param('timeBlockId') timeBlockId: string,
    @Body() body: CreateTimeBlockDto,
  ) {
    return this.projectsService.updateTimeBlock(timeBlockId, req.user.id, new Date(body.startTime), new Date(body.endTime));
  }

  @Delete('timeblocks/:timeBlockId')
  deleteTimeBlock(@Req() req: any, @Param('timeBlockId') timeBlockId: string) {
    return this.projectsService.deleteTimeBlock(timeBlockId, req.user.id);
  }

  @Public()
  @Post('webhooks/github')
  async handleGitHubWebhook(
    @Body() payload: any,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const closedTaskIds = await this.projectsService.handleGitHubWebhook(payload, signature);
    if (this.trackingGateway.server) {
      for (const taskId of closedTaskIds) {
        this.trackingGateway.server.emit('task-status-changed', { taskId });
      }
    }
    return { closedTaskIds };
  }

  @Public()
  @Get('mock-calendar')
  getMockCalendar(
    @Query('format') format = 'ics',
    @Query('email') email = 'alice@test.com'
  ) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    // Événement 1 : aujourd'hui, de 10:00 à 12:00 UTC
    const start1 = new Date(`${todayStr}T10:00:00Z`);
    const end1 = new Date(`${todayStr}T12:00:00Z`);
    
    // Événement 2 : demain, de 14:00 à 16:00 UTC
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const start2 = new Date(`${tomorrowStr}T14:00:00Z`);
    const end2 = new Date(`${tomorrowStr}T16:00:00Z`);

    if (format === 'json') {
      return [
        {
          title: `Rendez-vous dentiste (Google Calendar - ${email})`,
          start: start1.toISOString(),
          end: end1.toISOString(),
          userEmail: email,
        },
        {
          title: `Comité de Direction (Outlook Calendar - ${email})`,
          start: start2.toISOString(),
          end: end2.toISOString(),
          userEmail: email,
        }
      ];
    } else {
      const formatIcsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Planner Pro//Mock Calendar//FR
BEGIN:VEVENT
UID:event-1
SUMMARY:Rendez-vous dentiste (Google Calendar - ${email})
DTSTART:${formatIcsDate(start1)}
DTEND:${formatIcsDate(end1)}
DESCRIPTION:Rendez-vous de contrôle
END:VEVENT
BEGIN:VEVENT
UID:event-2
SUMMARY:Comité de Direction (Outlook Calendar - ${email})
DTSTART:${formatIcsDate(start2)}
DTEND:${formatIcsDate(end2)}
DESCRIPTION:Comité stratégique mensuel
END:VEVENT
END:VCALENDAR`;
    }
  }

  @Post('workspaces/:workspaceId/resources/optimize')
  async optimizeResources(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
  ) {
    const result = await this.projectsService.optimizeWorkspaceResources(workspaceId, req.user.id);
    if (result.success && result.reallocatedTaskIds && this.trackingGateway.server) {
      for (const taskId of result.reallocatedTaskIds) {
        this.trackingGateway.server.emit('task-status-changed', { taskId });
      }
    }
    return result;
  }

  @Get('workspaces/:workspaceId/integrations')
  listIntegrations(@Param('workspaceId') workspaceId: string) {
    return this.integrationService.listIntegrations(workspaceId);
  }

  @Post('workspaces/:workspaceId/integrations')
  createIntegration(
    @Param('workspaceId') workspaceId: string,
    @Body() body: IntegrationDto,
  ) {
    return this.integrationService.createIntegration(workspaceId, body);
  }

  @Post('integrations/:integrationId/toggle')
  toggleIntegration(@Param('integrationId') integrationId: string) {
    return this.integrationService.toggleIntegration(integrationId);
  }

  @Delete('integrations/:integrationId')
  deleteIntegration(@Param('integrationId') integrationId: string) {
    return this.integrationService.deleteIntegration(integrationId);
  }

  @Post('workspaces/:workspaceId/integrations/:integrationId/export')
  exportToCalendar(
    @Param('workspaceId') workspaceId: string,
    @Param('integrationId') integrationId: string,
  ) {
    return this.calendarSyncService.exportToCalendar(workspaceId, integrationId);
  }

  @Get('workspaces/:workspaceId/calendar-conflicts')
  getCalendarConflicts(@Param('workspaceId') workspaceId: string) {
    return this.calendarSyncService.detectCalendarConflicts(workspaceId);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CALENDAR OAUTH & BIDIRECTIONAL SYNC (Lot B)
  // ═══════════════════════════════════════════════════════════════════

  @Get('workspaces/:workspaceId/calendar/oauth/google/auth-url')
  getGoogleAuthUrl(@Param('workspaceId') workspaceId: string) {
    return { url: this.calendarSyncService.generateAuthUrl('GOOGLE_CALENDAR', workspaceId) };
  }

  @Get('workspaces/:workspaceId/calendar/oauth/outlook/auth-url')
  getOutlookAuthUrl(@Param('workspaceId') workspaceId: string) {
    return { url: this.calendarSyncService.generateAuthUrl('OUTLOOK', workspaceId) };
  }

  @Post('workspaces/:workspaceId/calendar/oauth/callback')
  handleOAuthCallback(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { provider: 'GOOGLE_CALENDAR' | 'OUTLOOK'; code: string },
  ) {
    return this.calendarSyncService.handleOAuthCallback(workspaceId, body.provider, body.code);
  }

  @Post('workspaces/:workspaceId/calendar/sync')
  syncCalendarEvents(@Param('workspaceId') workspaceId: string) {
    return this.calendarSyncService.syncCalendarEvents(workspaceId);
  }


  @Post('workspaces/:workspaceId/sprints')
  createSprint(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateSprintDto,
  ) {
    return this.sprintService.createSprint(workspaceId, req.user.id, body);
  }

  @Get('workspaces/:workspaceId/sprints')
  listSprints(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    return this.sprintService.listSprints(workspaceId, req.user.id);
  }

  @Put('sprints/:sprintId')
  updateSprint(
    @Req() req: any,
    @Param('sprintId') sprintId: string,
    @Body() body: UpdateSprintDto,
  ) {
    return this.sprintService.updateSprint(sprintId, req.user.id, body);
  }

  @Delete('sprints/:sprintId')
  deleteSprint(@Req() req: any, @Param('sprintId') sprintId: string) {
    return this.sprintService.deleteSprint(sprintId, req.user.id);
  }

  @Post('sprints/:sprintId/tasks')
  async associateTasksToSprint(
    @Req() req: any,
    @Param('sprintId') sprintId: string,
    @Body() body: { taskIds: string[] },
  ) {
    const sId = sprintId === 'backlog' ? null : sprintId;
    await this.sprintService.associateTasksToSprint(sId, body.taskIds, req.user.id);
    if (this.trackingGateway.server) {
      for (const id of body.taskIds) {
        this.trackingGateway.server.emit('task-status-changed', { taskId: id });
      }
    }
    return { success: true };
  }

  @Get('workspaces/:workspaceId/velocity')
  async getAverageVelocity(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    const velocity = await this.sprintService.getAverageVelocity(workspaceId, req.user.id);
    return { velocity };
  }

  @Get('sprints/:sprintId/burndown')
  getBurndownChart(@Req() req: any, @Param('sprintId') sprintId: string) {
    return this.sprintService.getBurndownChart(sprintId, req.user.id);
  }
}
