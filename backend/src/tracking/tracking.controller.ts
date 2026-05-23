import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get('active')
  getActiveTracking(@Req() req: any) {
    return this.trackingService.getActiveTracking(req.user.id);
  }

  @Post('start/:taskId')
  startTracking(@Req() req: any, @Param('taskId') taskId: string) {
    return this.trackingService.startTracking(req.user.id, taskId);
  }

  @Post('stop')
  stopTracking(@Req() req: any) {
    return this.trackingService.stopActiveTracking(req.user.id);
  }

  @Get('logs')
  getUserTimeLogs(@Req() req: any) {
    return this.trackingService.getUserTimeLogs(req.user.id);
  }

  @Get('logs/:taskId')
  getTimeLogsForTask(@Param('taskId') taskId: string) {
    return this.trackingService.getTimeLogsForTask(taskId);
  }
}
