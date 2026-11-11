/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Controller,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { resolveThrottlerTracker } from '../common/app-throttler.guard';
import { Public } from '../auth/public.decorator';
import { UuidPipe } from '../common/uuid.pipe';
import { ForbiddenInImpersonation } from '../auth/forbidden-in-impersonation.decorator';
import { RealtimeService } from '../realtime/realtime.service';
import { GitHubWebhookService } from './github-webhook.service';
import { TasksService } from './tasks.service';

/**
 * Webhook GitHub par projet (S21). La route de réception est publique : elle est authentifiée par
 * la signature HMAC du corps brut avec le secret du projet. La régénération du secret exige une
 * session et le droit `project.manage`.
 */
@Controller('projects')
export class GitHubWebhookController {
  constructor(
    private readonly webhooks: GitHubWebhookService,
    private readonly tasksService: TasksService,
    private readonly realtime: RealtimeService,
  ) {}

  // Hors du limiteur global (S24) : GitHub envoie depuis un petit nombre d'adresses partagées par
  // tous ses clients, un 429 ferait perdre des livraisons légitimes. Le contrôle est la signature
  // HMAC ; les refus, eux, sont comptés par adresse (GitHubWebhookService.registerFailure).
  @SkipThrottle()
  @Public()
  @Post(':projectId/webhooks/github')
  async receive(
    @Param('projectId', UuidPipe) projectId: string,
    @Req() req: RawBodyRequest<any>,
    @Headers('x-hub-signature-256') signature?: string,
    @Headers('x-github-delivery') deliveryId?: string,
  ) {
    const closedTaskIds = await this.webhooks.handle(
      projectId,
      req.rawBody,
      signature,
      deliveryId,
      resolveThrottlerTracker(req),
    );
    if (this.realtime.isReady && closedTaskIds.length > 0) {
      const tasks = await this.tasksService.getTasksForBroadcast(closedTaskIds);
      for (const task of tasks) {
        this.realtime.emitToProject(task.projectId, 'task-status-changed', {
          taskId: task.id,
          task,
        });
      }
    }
    return { closedTaskIds };
  }

  /** Régénère le secret (l'ancien cesse de valoir) ; renvoyé en clair cette seule fois. */
  @ForbiddenInImpersonation()
  @Post(':projectId/webhooks/github/secret')
  regenerateSecret(@Param('projectId', UuidPipe) projectId: string, @Req() req: any) {
    return this.webhooks.regenerateSecret(projectId, req.user.id);
  }

  /**
   * Ancienne route à secret global (supprimée par S21) : 410 pour que les clients qui l'ont
   * configurée voient l'échec et reconfigurent leur webhook avec le secret de leur projet.
   */
  @Public()
  @Post('webhooks/github')
  legacy(): never {
    throw new HttpException(
      'Cette URL de webhook est supprimée : utilisez /projects/<id-du-projet>/webhooks/github avec le secret du projet.',
      HttpStatus.GONE,
    );
  }
}
