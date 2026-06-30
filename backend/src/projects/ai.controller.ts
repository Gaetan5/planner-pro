import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AiService, ResolvedAiAction } from './ai.service';
import { CopilotService } from './copilot.service';
import { AiCommandDto } from './dto/ai-command.dto';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { TASK_INCLUDE } from './tasks.service';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
  };
}

@Controller('projects/ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly copilotService: CopilotService,
    private readonly trackingGateway: TrackingGateway,
    private readonly prisma: PrismaService,
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
  async executeActions(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      workspaceId: string;
      projectId?: string;
      actions: ResolvedAiAction[];
    },
  ) {
    const result = await this.aiService.executeActions(
      req.user.id,
      body.workspaceId,
      body.projectId || null,
      body.actions,
    );

    // Diffuser des notifications WebSocket pour rafraîchir en temps réel chez les autres clients connectés
    if (result.success && this.trackingGateway.server) {
      const room = `workspace:${body.workspaceId}`;
      // Émettre un signal général de mise à jour du projet/workspace
      this.trackingGateway.server.to(room).emit('project-data-updated', {
        workspaceId: body.workspaceId,
        projectId: body.projectId || null,
      });

      // Diffuser individuellement pour les tâches modifiées si nécessaire
      for (const action of body.actions) {
        if (action.taskId && typeof action.taskId === 'string') {
          const dbTask = await this.prisma.task.findUnique({
            where: { id: action.taskId },
            include: TASK_INCLUDE,
          });
          if (dbTask) {
            this.trackingGateway.server.to(room).emit('task-status-changed', {
              taskId: action.taskId,
              task: dbTask,
            });
          }
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
  async getCopilotAlerts(@Query('workspaceId') workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId requis.');
    }
    return this.copilotService.calculatePredictiveAlerts(workspaceId);
  }

  /**
   * Retourne le briefing matinal personnalisé.
   */
  @Get('copilot/briefing')
  async getCopilotBriefing(
    @Req() req: AuthenticatedRequest,
    @Query('workspaceId') workspaceId: string,
    @Query('isMock') isMock?: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId requis.');
    }
    const mockBool = isMock === 'true' || isMock === '1';
    const briefingText = await this.copilotService.generateBriefing(
      req.user.id,
      workspaceId,
      mockBool,
    );
    return { briefing: briefingText };
  }
}
