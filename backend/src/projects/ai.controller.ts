import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { AiService, ResolvedAiAction } from './ai.service';
import { CopilotService } from './copilot.service';
import { AiCommandDto } from './dto/ai-command.dto';
import { RealtimeService } from '../realtime/realtime.service';
import { ProjectsService } from './projects.service';
import { ExecuteAiActionsDto } from './dto/execute-ai-actions.dto';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
  };
}

@Controller('projects/ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly copilotService: CopilotService,
    private readonly realtime: RealtimeService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Analyse une commande en langage naturel et retourne les actions résolues à valider.
   */
  @Post('command')
  @HttpCode(HttpStatus.OK)
  async analyzeCommand(@Req() req: AuthenticatedRequest, @Body() body: AiCommandDto) {
    return this.aiService.analyzeCommand(
      req.user.id,
      body.workspaceId,
      body.projectId || null,
      body.command,
    );
  }

  /**
   * Transcrit un fichier audio et retourne la transcription et les actions résolues.
   */
  @Post('voice')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  async analyzeVoice(
    @Req() req: AuthenticatedRequest,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @UploadedFile() file: any,
    @Body('workspaceId') workspaceId: string,
    @Body('projectId') projectId?: string,
    @Body('isMock') isMock?: string,
  ) {
    if (!file) {
      throw new Error('Fichier audio manquant.');
    }
    const mockBool = isMock === 'true' || isMock === '1';
    return this.aiService.transcribeAndAnalyzeVoice(
      req.user.id,
      workspaceId,
      projectId || null,
      file.buffer,
      file.mimetype,
      mockBool,
    );
  }

  /**
   * Exécute une liste d'actions validées par l'utilisateur.
   */
  @Post('execute')
  @HttpCode(HttpStatus.OK)
  async executeActions(@Req() req: AuthenticatedRequest, @Body() body: ExecuteAiActionsDto) {
    const result = await this.aiService.executeActions(
      req.user.id,
      body.workspaceId,
      body.projectId || null,
      body.actions as ResolvedAiAction[],
    );

    // Diffusion limitée au workspace vérifié par le service : un signal non sensible, puis les
    // seules tâches réellement modifiées vers le salon de leur projet (S15, S16)
    if (result.success && this.realtime.isReady) {
      this.realtime.emitSignalToWorkspace(body.workspaceId, 'project-data-updated', {
        workspaceId: body.workspaceId,
        projectId: body.projectId || null,
      } as { workspaceId: string });
      if (result.changedTaskIds.length > 0) {
        const tasks = await this.projectsService.getTasksForBroadcast(result.changedTaskIds);
        for (const task of tasks) {
          this.realtime.emitToProject(task.projectId, 'task-status-changed', {
            taskId: task.id,
            task,
          });
        }
      }
    }

    return result;
  }

  /**
   * Analyse une image et retourne les actions résolues à valider.
   */
  @Post('vision')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  async analyzeVision(
    @Req() req: AuthenticatedRequest,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @UploadedFile() file: any,
    @Body('workspaceId') workspaceId: string,
    @Body('projectId') projectId?: string,
    @Body('isMock') isMock?: string,
  ) {
    if (!file) {
      throw new Error('Fichier image manquant.');
    }
    const mockBool = isMock === 'true' || isMock === '1';
    return this.aiService.analyzeImageAndResolve(
      req.user.id,
      workspaceId,
      projectId || null,
      file.buffer,
      file.mimetype,
      mockBool,
    );
  }

  /**
   * Retourne les alertes prédictives calculées pour le workspace.
   */
  @Get('copilot/alerts')
  async getCopilotAlerts(
    @Req() req: AuthenticatedRequest,
    @Query('workspaceId') workspaceId: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId requis.');
    }
    return this.copilotService.calculatePredictiveAlerts(workspaceId, req.user.id);
  }

  /**
   * Retourne le briefing matinal personnalisé.
   */
  @Get('copilot/briefing')
  async getCopilotBriefing(
    @Req() req: AuthenticatedRequest,
    @Query('workspaceId') workspaceId: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId requis.');
    }
    return this.copilotService.generateBriefing(req.user.id, workspaceId);
  }
}
