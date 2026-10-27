import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { User, AuthenticatedUser } from '../auth/user.decorator';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { AdminPaginationQueryDto, UpdateUserRoleDto } from './dto/admin.dto';

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
  getActivity(@Query() query: AdminPaginationQueryDto) {
    return this.adminService.getActivity(query.page, query.pageSize, query.search);
  }

  @Get('users')
  getUsers(@Query() query: AdminPaginationQueryDto) {
    return this.adminService.getUsers(query.page, query.pageSize, query.search);
  }

  @Patch('users/:id/role')
  updateUserRole(
    @User() actor: AuthenticatedUser,
    @Param('id') targetUserId: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.adminService.updateUserRole(actor.id, targetUserId, dto.role ?? null);
  }

  @Post('users/:id/revoke-sessions')
  revokeUserSessions(@User() actor: AuthenticatedUser, @Param('id') targetUserId: string) {
    return this.adminService.revokeUserSessions(actor.id, targetUserId);
  }

  @Post('users/:id/impersonate')
  impersonateUser(@User() actor: AuthenticatedUser, @Param('id') targetUserId: string) {
    return this.adminService.impersonateUser(actor.id, targetUserId);
  }

  @Get('workspaces')
  getWorkspaces(@Query() query: AdminPaginationQueryDto) {
    return this.adminService.getWorkspaces(query.page, query.pageSize, query.search);
  }
}
