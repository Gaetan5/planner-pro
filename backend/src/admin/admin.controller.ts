import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';

class ActivityQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  getOverview() {
    return this.adminService.getOverview();
  }

  @Get('health')
  getHealth() {
    return this.adminService.getHealth();
  }

  @Get('activity')
  getActivity(@Query() query: ActivityQuery) {
    return this.adminService.getActivity(query.page, query.pageSize);
  }
}
