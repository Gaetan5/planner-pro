import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { ForbiddenInImpersonation } from '../auth/forbidden-in-impersonation.decorator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { setSessionCookies } from '../auth/session-cookies';
import { User, AuthenticatedUser } from '../auth/user.decorator';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { AdminPaginationQueryDto, UpdateUserRoleDto } from './dto/admin.dto';
import { FeatureFlagGuard, RequireFeature } from '../config/feature-flag.guard';

// Aucune action d'administration depuis une session d'impersonation (S18.2)
@ForbiddenInImpersonation()
@Controller('admin')
// FeatureFlagGuard en premier : une route désactivée répond 404 avant toute authentification
@UseGuards(FeatureFlagGuard, JwtAuthGuard, PlatformAdminGuard)
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
  @RequireFeature('IMPERSONATION')
  async impersonateUser(
    @User() actor: AuthenticatedUser,
    @Param('id') targetUserId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, ...body } = await this.adminService.impersonateUser(actor.id, targetUserId);
    // La session d'impersonation remplace les cookies du navigateur ; aucun jeton dans le corps
    setSessionCookies(res, session);
    return body;
  }

  @Get('workspaces')
  getWorkspaces(@Query() query: AdminPaginationQueryDto) {
    return this.adminService.getWorkspaces(query.page, query.pageSize, query.search);
  }
}
