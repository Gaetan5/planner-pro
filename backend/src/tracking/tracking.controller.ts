import { Controller, Get, Post, Param, Req } from '@nestjs/common';
import { UuidPipe } from '../common/uuid.pipe';
import { TrackingService } from './tracking.service';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get('active')
  getActiveTracking(@Req() req: any) {
    return this.trackingService.getActiveTracking(req.user.id);
  }

  @Post('start/:taskId')
  startTracking(@Req() req: any, @Param('taskId', UuidPipe) taskId: string) {
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
  getTimeLogsForTask(@Req() req: any, @Param('taskId', UuidPipe) taskId: string) {
    return this.trackingService.getTimeLogsForTask(req.user.id, taskId);
  }
}
