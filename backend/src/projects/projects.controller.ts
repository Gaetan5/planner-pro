/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Req,
  Query,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ForbiddenInImpersonation } from '../auth/forbidden-in-impersonation.decorator';
import { DeliverableStatus } from '@prisma/client';
import { ProjectsService } from './projects.service';
import { SprintService } from './sprint.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PolicyService } from '../authz/policy.service';
import { ProjectPermissionsService } from './project-permissions.service';
import { IntegrationService } from './integration.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
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
import { AssociateTasksDto } from './dto/associate-tasks.dto';
import { AssignProjectRoleDto } from './dto/assign-project-role.dto';
import { ProactiveSchedulerService } from './proactive-scheduler.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly sprintService: SprintService,
    private readonly realtime: RealtimeService,
    private readonly integrationService: IntegrationService,
    private readonly calendarSyncService: CalendarSyncService,
    private readonly projectPermissionsService: ProjectPermissionsService,
    private readonly policy: PolicyService,
    private readonly proactiveSchedulerService: ProactiveSchedulerService,
  ) {}

  /**
   * Diffuse l'état à jour de tâches DÉJÀ modifiées et autorisées, uniquement vers le salon de
   * leur projet (A4, S16).
   */
  private async broadcastTasks(taskIds: string[], event = 'task-status-changed') {
    if (!this.realtime.isReady || taskIds.length === 0) return;
    const tasks = await this.projectsService.getTasksForBroadcast(taskIds);
    for (const task of tasks) {
      this.realtime.emitToProject(task.projectId, event, { taskId: task.id, task });
    }
  }

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

  @Get('workspaces/:workspaceId/audit/logs')
  getAuditLogs(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
    @Query('limit') limit?: string,
  ) {
    return this.projectPermissionsService.getAuditLogs(
      req.user.id,
      workspaceId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get(':id/audit/logs')
  getProjectAuditLogs(
    @Req() req: any,
    @Param('id') projectId: string,
    @Query('limit') limit?: string,
  ) {
    return this.projectPermissionsService.getProjectAuditLogs(
      projectId,
      req.user.id,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get(':id/members')
  getProjectMembers(@Req() req: any, @Param('id') projectId: string) {
    return this.projectPermissionsService.getProjectMembers(projectId, req.user.id);
  }

  @Post(':id/members')
  @ForbiddenInImpersonation()
  assignProjectRole(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body() body: AssignProjectRoleDto,
  ) {
    return this.projectPermissionsService.assignProjectRole(
      projectId,
      body.targetUserId,
      body.role,
      req.user.id,
    );
  }

  @Delete(':id/members/:userId')
  @ForbiddenInImpersonation()
  removeProjectRole(
    @Req() req: any,
    @Param('id') projectId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.projectPermissionsService.removeProjectRole(projectId, targetUserId, req.user.id);
  }

  @Get('timeblocks/all')
  getTimeBlocks(@Req() req: any, @Query('start') start?: string, @Query('end') end?: string) {
    return this.projectsService.getTimeBlocks(
      req.user.id,
      start ? new Date(start) : undefined,
      end ? new Date(end) : undefined,
    );
  }

  @Get('resources/capacity')
  getResourceCapacity(@Req() req: any, @Query('workspaceId') workspaceId?: string) {
    return this.projectsService.getResourceCapacityReport(req.user.id, workspaceId);
  }

  @Put('resources/:userId/profile')
  updateResourceProfile(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: UpdateResourceProfileDto,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.projectsService.updateResourceProfile(req.user.id, userId, body, workspaceId);
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
  createDelivery(@Req() req: any, @Param('id') projectId: string, @Body() body: CreateDeliveryDto) {
    return this.projectsService.createDelivery(
      projectId,
      req.user.id,
      body.summary,
      body.checklist,
    );
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
  toggleDeliveryChecklistItem(@Req() req: any, @Param('itemId') itemId: string) {
    return this.projectsService.toggleDeliveryChecklistItem(itemId, req.user.id);
  }

  @Post(':id/tasks')
  createTask(@Req() req: any, @Param('id') projectId: string, @Body() body: CreateTaskDto) {
    const { title, description, priority, ...options } = body;
    return this.projectsService.createTask(
      projectId,
      req.user.id,
      title,
      description,
      priority,
      options,
    );
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
    return this.projectsService.createMilestone(
      projectId,
      req.user.id,
      body.name,
      body.description,
      body.dueDate,
    );
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
    return this.projectsService.addTaskDependency(
      taskId,
      req.user.id,
      body.dependsOnTaskId,
      body.type,
    );
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
  async updateTask(@Req() req: any, @Param('taskId') taskId: string, @Body() body: UpdateTaskDto) {
    const updated = await this.projectsService.updateTask(taskId, req.user.id, body);
    if (this.realtime.isReady) {
      const [dbTask] = await this.projectsService.getTasksForBroadcast([taskId]);
      if (dbTask) {
        if (body.status) {
          this.realtime.emitToProject(dbTask.projectId, 'task-status-changed', {
            taskId,
            task: dbTask,
          });
        }
        const impactedTaskIds = (updated as any).impactedTaskIds;
        if (impactedTaskIds && impactedTaskIds.length > 0) {
          const impactedTasks = await this.projectsService.getTasksForBroadcast(impactedTaskIds);
          this.realtime.emitToProject(dbTask.projectId, 'task-schedule-propagated', {
            projectId: (updated as any).projectId,
            impactedTaskIds,
            impactedTasks,
          });
          for (const t of impactedTasks) {
            this.realtime.emitToProject(t.projectId, 'task-status-changed', {
              taskId: t.id,
              task: t,
            });
          }
        }
        // Lancer la détection proactive de risques en arrière-plan (non bloquante)
        if (dbTask.project?.workspaceId) {
          this.proactiveSchedulerService.runProactiveChecksForWorkspace(dbTask.project.workspaceId);
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
    return this.projectsService.createTimeBlock(
      taskId,
      req.user.id,
      new Date(body.startTime),
      new Date(body.endTime),
    );
  }

  @Put('timeblocks/:timeBlockId')
  updateTimeBlock(
    @Req() req: any,
    @Param('timeBlockId') timeBlockId: string,
    @Body() body: CreateTimeBlockDto,
  ) {
    return this.projectsService.updateTimeBlock(
      timeBlockId,
      req.user.id,
      new Date(body.startTime),
      new Date(body.endTime),
    );
  }

  @Delete('timeblocks/:timeBlockId')
  deleteTimeBlock(@Req() req: any, @Param('timeBlockId') timeBlockId: string) {
    return this.projectsService.deleteTimeBlock(timeBlockId, req.user.id);
  }

  @Post('workspaces/:workspaceId/resources/optimize')
  async optimizeResources(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    const result = await this.projectsService.optimizeWorkspaceResources(workspaceId, req.user.id);
    if (result.success && result.reallocatedTaskIds) {
      await this.broadcastTasks(result.reallocatedTaskIds);
    }
    return result;
  }

  @Get('workspaces/:workspaceId/integrations')
  async listIntegrations(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    // Configuration interne : pas pour un VIEWER (P11)
    await this.policy.assertWorkspace(workspaceId, req.user.id, 'workspace.directory.read');
    return this.integrationService.listIntegrations(workspaceId);
  }

  @Get('workspaces/:workspaceId/integrations/status')
  async getIntegrationsStatus(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    await this.policy.assertWorkspace(workspaceId, req.user.id, 'workspace.directory.read');
    return this.integrationService.getIntegrationsStatus(workspaceId);
  }

  @Post('workspaces/:workspaceId/integrations')
  @ForbiddenInImpersonation()
  async createIntegration(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateIntegrationDto,
  ) {
    await this.projectPermissionsService.assertWorkspaceAccess(workspaceId, req.user.id, [
      'OWNER',
      'ADMIN',
    ]);
    return this.integrationService.createIntegration(workspaceId, body);
  }

  /**
   * Résout le workspace d'une intégration et exige OWNER/ADMIN. Intégration absente ou d'un
   * workspace dont l'appelant n'est pas membre : même 404 (S14, pas d'oracle d'existence).
   */
  private async resolveManagedIntegration(integrationId: string, userId: string) {
    const workspaceId = await this.integrationService.getWorkspaceIdOf(integrationId);
    if (!workspaceId) throw new NotFoundException('Intégration introuvable.');
    try {
      await this.policy.assertWorkspace(workspaceId, userId, 'workspace.integrations.manage');
    } catch (error) {
      if (error instanceof ForbiddenException && (await this.isMember(workspaceId, userId))) {
        throw error;
      }
      throw new NotFoundException('Intégration introuvable.');
    }
    return workspaceId;
  }

  private async isMember(workspaceId: string, userId: string): Promise<boolean> {
    try {
      await this.policy.assertWorkspace(workspaceId, userId, 'workspace.read');
      return true;
    } catch {
      return false;
    }
  }

  @Post('integrations/:integrationId/toggle')
  async toggleIntegration(@Req() req: any, @Param('integrationId') integrationId: string) {
    const workspaceId = await this.resolveManagedIntegration(integrationId, req.user.id);
    return this.integrationService.toggleIntegration(workspaceId, integrationId);
  }

  @Delete('integrations/:integrationId')
  async deleteIntegration(@Req() req: any, @Param('integrationId') integrationId: string) {
    const workspaceId = await this.resolveManagedIntegration(integrationId, req.user.id);
    return this.integrationService.deleteIntegration(workspaceId, integrationId);
  }

  @Post('workspaces/:workspaceId/integrations/:integrationId/export')
  async exportToCalendar(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
    @Param('integrationId') integrationId: string,
  ) {
    // Écrit dans l'agenda externe avec les jetons OAuth du workspace : OWNER/ADMIN uniquement (S5)
    await this.projectPermissionsService.assertWorkspaceAccess(workspaceId, req.user.id, [
      'OWNER',
      'ADMIN',
    ]);
    return this.calendarSyncService.exportToCalendar(workspaceId, integrationId);
  }

  @Get('workspaces/:workspaceId/calendar-conflicts')
  async getCalendarConflicts(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    await this.policy.assertWorkspace(workspaceId, req.user.id, 'workspace.read');
    // Uniquement les créneaux des projets accessibles à l'appelant (S12)
    const projectIds = await this.policy.listAccessibleProjectIds(req.user.id, { workspaceId });
    return this.calendarSyncService.detectCalendarConflicts(workspaceId, projectIds);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CALENDAR OAUTH & BIDIRECTIONAL SYNC (Lot B)
  // ═══════════════════════════════════════════════════════════════════

  @Get('workspaces/:workspaceId/calendar/oauth/google/auth-url')
  async getGoogleAuthUrl(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    await this.projectPermissionsService.assertWorkspaceAccess(workspaceId, req.user.id);
    return { url: this.calendarSyncService.generateAuthUrl('GOOGLE_CALENDAR', workspaceId) };
  }

  @Get('workspaces/:workspaceId/calendar/oauth/outlook/auth-url')
  async getOutlookAuthUrl(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    await this.projectPermissionsService.assertWorkspaceAccess(workspaceId, req.user.id);
    return { url: this.calendarSyncService.generateAuthUrl('OUTLOOK', workspaceId) };
  }

  @Post('workspaces/:workspaceId/calendar/oauth/callback')
  @ForbiddenInImpersonation()
  async handleOAuthCallback(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
    @Body() body: { provider: 'GOOGLE_CALENDAR' | 'OUTLOOK'; code: string },
  ) {
    await this.projectPermissionsService.assertWorkspaceAccess(workspaceId, req.user.id, [
      'OWNER',
      'ADMIN',
    ]);
    return this.calendarSyncService.handleOAuthCallback(workspaceId, body.provider, body.code);
  }

  @Post('workspaces/:workspaceId/calendar/sync')
  async syncCalendarEvents(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    // Importe des créneaux dans le planning : OWNER/ADMIN uniquement, tâche créée au nom de l'appelant (S5)
    await this.projectPermissionsService.assertWorkspaceAccess(workspaceId, req.user.id, [
      'OWNER',
      'ADMIN',
    ]);
    return this.calendarSyncService.syncCalendarEvents(workspaceId, req.user.id);
  }

  @Post('workspaces/:workspaceId/auto-schedule')
  async autoScheduleWorkspace(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    // Droits et périmètre (projets où l'appelant peut écrire) contrôlés par le service (S12)
    return this.proactiveSchedulerService.autoScheduleWorkspace(workspaceId, req.user.id);
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
    @Body() body: AssociateTasksDto,
  ) {
    const sId = sprintId === 'backlog' ? null : sprintId;
    const changed = await this.sprintService.associateTasksToSprint(sId, body.taskIds, req.user.id);
    // Uniquement les tâches vérifiées et modifiées, vers le salon de leur projet (S13)
    await this.broadcastTasks(changed.map((t) => t.id));
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

  @Get('workspaces/:workspaceId/finances')
  getWorkspaceFinancialSummary(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    return this.projectsService.getWorkspaceFinancialSummary(workspaceId, req.user.id);
  }
}
