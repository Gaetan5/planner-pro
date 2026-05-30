import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AiService } from './ai.service';
import { AiCommandDto } from './dto/ai-command.dto';
import { TrackingGateway } from '../tracking/tracking.gateway';

@Controller('projects/ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly trackingGateway: TrackingGateway,
  ) {}

  /**
   * Analyse une commande en langage naturel et retourne les actions résolues à valider.
   */
  @Post('command')
  @HttpCode(HttpStatus.OK)
  async analyzeCommand(
    @Req() req: any,
    @Body() body: AiCommandDto,
  ) {
    return this.aiService.analyzeCommand(
      req.user.id,
      body.workspaceId,
      body.projectId || null,
      body.command,
    );
  }

  /**
   * Exécute une liste d'actions validées par l'utilisateur.
   */
  @Post('execute')
  @HttpCode(HttpStatus.OK)
  async executeActions(
    @Req() req: any,
    @Body() body: { workspaceId: string; projectId?: string; actions: any[] },
  ) {
    const result = await this.aiService.executeActions(
      req.user.id,
      body.workspaceId,
      body.projectId || null,
      body.actions,
    );

    // Diffuser des notifications WebSocket pour rafraîchir en temps réel chez les autres clients connectés
    if (result.success && this.trackingGateway.server) {
      // Émettre un signal général de mise à jour du projet/workspace
      this.trackingGateway.server.emit('project-data-updated', {
        workspaceId: body.workspaceId,
        projectId: body.projectId || null,
      });

      // Diffuser individuellement pour les tâches modifiées si nécessaire
      for (const action of body.actions) {
        if (action.taskId) {
          this.trackingGateway.server.emit('task-status-changed', { taskId: action.taskId });
        }
      }
    }

    return result;
  }
}
