import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Req } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  createProject(@Req() req: any, @Body() body: { name: string; description?: string }) {
    return this.projectsService.createProject(req.user.id, body.name, body.description);
  }

  @Get()
  getProjects(@Req() req: any) {
    return this.projectsService.getProjects(req.user.id);
  }

  @Get(':id')
  getProject(@Param('id') id: string) {
    return this.projectsService.getProject(id);
  }

  @Delete(':id')
  deleteProject(@Param('id') id: string) {
    return this.projectsService.deleteProject(id);
  }

  @Post(':id/tasks')
  createTask(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body() body: { title: string; description?: string; priority?: string },
  ) {
    return this.projectsService.createTask(projectId, req.user.id, body.title, body.description, body.priority);
  }

  @Get(':id/tasks')
  getTasks(@Param('id') projectId: string) {
    return this.projectsService.getTasks(projectId);
  }

  @Put('tasks/:taskId')
  updateTask(
    @Param('taskId') taskId: string,
    @Body() body: { title?: string; description?: string; status?: string; priority?: string },
  ) {
    return this.projectsService.updateTask(taskId, body);
  }

  @Delete('tasks/:taskId')
  deleteTask(@Param('taskId') taskId: string) {
    return this.projectsService.deleteTask(taskId);
  }

  @Post('tasks/:taskId/timeblocks')
  createTimeBlock(
    @Param('taskId') taskId: string,
    @Body() body: { startTime: string; endTime: string },
  ) {
    return this.projectsService.createTimeBlock(taskId, new Date(body.startTime), new Date(body.endTime));
  }

  @Get('timeblocks/all')
  getTimeBlocks(@Req() req: any) {
    return this.projectsService.getTimeBlocks(req.user.id);
  }

  @Put('timeblocks/:timeBlockId')
  updateTimeBlock(
    @Param('timeBlockId') timeBlockId: string,
    @Body() body: { startTime: string; endTime: string },
  ) {
    return this.projectsService.updateTimeBlock(timeBlockId, new Date(body.startTime), new Date(body.endTime));
  }

  @Delete('timeblocks/:timeBlockId')
  deleteTimeBlock(@Param('timeBlockId') timeBlockId: string) {
    return this.projectsService.deleteTimeBlock(timeBlockId);
  }
}
