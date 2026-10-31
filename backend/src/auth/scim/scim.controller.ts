import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ScimService } from './scim.service';
import { ScimAuthGuard } from './scim.guard';
import { JwtAuthGuard } from '../jwt.guard';
import { Public } from '../public.decorator';
import { CreateScimUserDto, ScimPatchRequest } from './scim.dto';
import { FeatureFlagGuard, RequireFeature } from '../../config/feature-flag.guard';

interface ScimRequest {
  scimWorkspace: {
    id: string;
    name: string;
  };
}

interface AuthenticatedUserRequest {
  user: {
    id: string;
    email: string;
  };
}

@Controller()
@RequireFeature('SCIM')
@UseGuards(FeatureFlagGuard)
export class ScimController {
  constructor(private readonly scimService: ScimService) {}

  // --- Endpoints Standard SCIM 2.0 (RFC 7644) ---

  @Public()
  @Get('scim/v2/ServiceProviderConfig')
  getServiceProviderConfig() {
    return this.scimService.getServiceProviderConfig();
  }

  @Public()
  @UseGuards(ScimAuthGuard)
  @Get('scim/v2/Users')
  async listUsers(
    @Req() req: ScimRequest,
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
  ) {
    const sIndex = startIndex ? parseInt(startIndex, 10) : 1;
    const cCount = count ? parseInt(count, 10) : 100;
    return this.scimService.listUsers(req.scimWorkspace.id, sIndex, cCount);
  }

  @Public()
  @UseGuards(ScimAuthGuard)
  @Get('scim/v2/Users/:id')
  async getUser(@Req() req: ScimRequest, @Param('id') id: string) {
    return this.scimService.getUser(req.scimWorkspace.id, id);
  }

  @Public()
  @UseGuards(ScimAuthGuard)
  @Post('scim/v2/Users')
  @HttpCode(HttpStatus.CREATED)
  async createUser(@Req() req: ScimRequest, @Body() dto: CreateScimUserDto) {
    return this.scimService.createUser(req.scimWorkspace.id, dto);
  }

  @Public()
  @UseGuards(ScimAuthGuard)
  @Put('scim/v2/Users/:id')
  async updateUser(
    @Req() req: ScimRequest,
    @Param('id') id: string,
    @Body() dto: CreateScimUserDto,
  ) {
    return this.scimService.updateUser(req.scimWorkspace.id, id, dto);
  }

  @Public()
  @UseGuards(ScimAuthGuard)
  @Patch('scim/v2/Users/:id')
  async patchUser(
    @Req() req: ScimRequest,
    @Param('id') id: string,
    @Body() patchRequest: ScimPatchRequest,
  ) {
    return this.scimService.patchUser(req.scimWorkspace.id, id, patchRequest);
  }

  @Public()
  @UseGuards(ScimAuthGuard)
  @Delete('scim/v2/Users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(@Req() req: ScimRequest, @Param('id') id: string) {
    await this.scimService.deleteUser(req.scimWorkspace.id, id);
  }

  // --- Endpoints de gestion des clés API SCIM pour les Admins de l'espace ---

  @UseGuards(JwtAuthGuard)
  @Get('workspaces/:workspaceId/scim/keys')
  async listApiKeys(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.scimService.listApiKeys(workspaceId, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('workspaces/:workspaceId/scim/keys')
  async createApiKey(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { name: string },
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.scimService.createApiKey(workspaceId, req.user.id, body.name);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('workspaces/:workspaceId/scim/keys/:keyId')
  async revokeApiKey(
    @Param('workspaceId') workspaceId: string,
    @Param('keyId') keyId: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.scimService.revokeApiKey(workspaceId, req.user.id, keyId);
  }
}
