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
  UseFilters,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ScimService } from './scim.service';
import { ScimEndpoint, ScimExceptionFilter } from './scim-http';
import { Public } from '../public.decorator';
import {
  CreateScimKeyDto,
  CreateScimUserDto,
  ScimListQueryDto,
  ScimPatchRequestDto,
} from './scim.dto';
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
  @UseFilters(ScimExceptionFilter)
  @Get('scim/v2/ServiceProviderConfig')
  getServiceProviderConfig() {
    return this.scimService.getServiceProviderConfig();
  }

  @ScimEndpoint()
  @Get('scim/v2/Users')
  async listUsers(@Req() req: ScimRequest, @Query() query: ScimListQueryDto) {
    return this.scimService.listUsers(
      req.scimWorkspace.id,
      query.startIndex ?? 1,
      query.count ?? 100,
      query.filter,
    );
  }

  @ScimEndpoint()
  @Get('scim/v2/Users/:id')
  async getUser(@Req() req: ScimRequest, @Param('id') id: string) {
    return this.scimService.getUser(req.scimWorkspace.id, id);
  }

  @ScimEndpoint()
  @Post('scim/v2/Users')
  @HttpCode(HttpStatus.CREATED)
  async createUser(@Req() req: ScimRequest, @Body() dto: CreateScimUserDto) {
    return this.scimService.createUser(req.scimWorkspace.id, dto);
  }

  @ScimEndpoint()
  @Put('scim/v2/Users/:id')
  async updateUser(
    @Req() req: ScimRequest,
    @Param('id') id: string,
    @Body() dto: CreateScimUserDto,
  ) {
    return this.scimService.updateUser(req.scimWorkspace.id, id, dto);
  }

  @ScimEndpoint()
  @Patch('scim/v2/Users/:id')
  async patchUser(
    @Req() req: ScimRequest,
    @Param('id') id: string,
    @Body() patchRequest: ScimPatchRequestDto,
  ) {
    return this.scimService.patchUser(req.scimWorkspace.id, id, patchRequest);
  }

  @ScimEndpoint()
  @Delete('scim/v2/Users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(@Req() req: ScimRequest, @Param('id') id: string) {
    await this.scimService.deleteUser(req.scimWorkspace.id, id);
  }

  // --- Endpoints de gestion des clés API SCIM pour les Admins de l'espace ---
  @Get('workspaces/:workspaceId/scim/keys')
  async listApiKeys(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.scimService.listApiKeys(workspaceId, req.user.id);
  }
  @Post('workspaces/:workspaceId/scim/keys')
  async createApiKey(
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateScimKeyDto,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.scimService.createApiKey(workspaceId, req.user.id, body);
  }
  @Delete('workspaces/:workspaceId/scim/keys/:keyId')
  async revokeApiKey(
    @Param('workspaceId') workspaceId: string,
    @Param('keyId') keyId: string,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.scimService.revokeApiKey(workspaceId, req.user.id, keyId);
  }
}
