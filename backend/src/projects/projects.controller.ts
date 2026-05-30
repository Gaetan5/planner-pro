import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Req, Query, Headers } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { DeliverableStatus } from '@prisma/client';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TrackingGateway } from '../tracking/tracking.gateway';
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
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly trackingGateway: TrackingGateway,
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
    if (body.status && this.trackingGateway.server) {
      this.trackingGateway.server.emit('task-status-changed', { taskId });
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
}
