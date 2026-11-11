import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PolicyService } from '../authz/policy.service';
import { decrypt, encrypt } from '../auth/encryption.util';
import {
  extractTaskIdsFromText,
  generateWebhookSecret,
  verifyGitHubSignature,
  WEBHOOK_FAILURE_WINDOW_SECONDS,
  WEBHOOK_FAILURES_PER_MINUTE,
  webhookAddressFailureKey,
  webhookFailureKey,
  webhookLimits,
} from './github-webhook.util';

export { WEBHOOK_FAILURES_PER_MINUTE };
import { TasksService } from './tasks.service';
import { ProjectPermissionsService } from './project-permissions.service';

/** Durée de mémorisation d'une livraison (`X-GitHub-Delivery`) : 24 h (anti-rejeu, S21). */
export const WEBHOOK_DELIVERY_TTL_SECONDS = 86_400;
/** Délai maximal d'un appel Redis du webhook : au-delà, refus (le client ioredis met en file sans limite). */
export const WEBHOOK_REDIS_TIMEOUT_MS = 2000;
/** Jeton d'injection du délai Redis : les tests le raccourcissent, la production garde 2 s. */
export const WEBHOOK_REDIS_TIMEOUT_TOKEN = 'WEBHOOK_REDIS_TIMEOUT_MS';

const DELIVERY_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Webhook GitHub par projet (S21) : secret propre à chaque projet (chiffré en base), signature sur
 * le corps brut, liaison au dépôt du projet, anti-rejeu Redis. Tout refus d'authentification est
 * un 401 uniforme ; Redis indisponible refuse la livraison (503, fail-closed).
 */
@Injectable()
export class GitHubWebhookService {
  private readonly logger = new Logger(GitHubWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly redis: RedisService,
    private readonly policy: PolicyService,
    private readonly permissions: ProjectPermissionsService,
    @Optional()
    @Inject(WEBHOOK_REDIS_TIMEOUT_TOKEN)
    private readonly redisTimeoutMs: number = WEBHOOK_REDIS_TIMEOUT_MS,
  ) {}

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException('Webhook refusé.');
  }

  /**
   * Traite une livraison pour `projectId`. Renvoie les identifiants des tâches fermées.
   * Ordre : projet et secret, signature, dépôt, anti-rejeu, puis traitement.
   */
  async handle(
    projectId: string,
    rawBody: Buffer | undefined,
    signature: string | undefined,
    deliveryId: string | undefined,
    clientIp?: string,
  ): Promise<string[]> {
    try {
      return await this.authenticateAndProcess(projectId, rawBody, signature, deliveryId);
    } catch (error) {
      if (error instanceof UnauthorizedException) await this.registerFailure(clientIp, projectId);
      throw error;
    }
  }

  /**
   * Compte un refus pour l'adresse appelante ; au-delà de `WEBHOOK_FAILURES_PER_MINUTE` par minute,
   * les refus suivants deviennent des 429. Au mieux : Redis indisponible ne change pas la réponse.
   */
  private async registerFailure(clientIp: string | undefined, projectId: string): Promise<void> {
    if (!clientIp) return;
    let failures: number;
    let addressFailures: number;
    try {
      [failures, addressFailures] = await this.withRedisTimeout(() =>
        Promise.all([
          this.redis.incrementWithTtl(
            webhookFailureKey(clientIp, projectId),
            WEBHOOK_FAILURE_WINDOW_SECONDS,
          ),
          // Compteur agrégé : s'incrémente quel que soit le projet visé (r45-m1)
          this.redis.incrementWithTtl(
            webhookAddressFailureKey(clientIp),
            WEBHOOK_FAILURE_WINDOW_SECONDS,
          ),
        ]),
      );
    } catch {
      return;
    }
    if (
      failures > WEBHOOK_FAILURES_PER_MINUTE ||
      addressFailures > webhookLimits.failuresPerAddressPerMinute
    ) {
      throw new HttpException('Trop de requêtes refusées.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async authenticateAndProcess(
    projectId: string,
    rawBody: Buffer | undefined,
    signature: string | undefined,
    deliveryId: string | undefined,
  ): Promise<string[]> {
    // Seule lecture du secret chiffré : l'omission globale (PRISMA_OMIT) est levée explicitement
    const stored = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      omit: { githubWebhookSecret: false },
    });
    if (!stored?.githubWebhookSecret) throw this.unauthorized();

    let secret: string;
    try {
      secret = decrypt(stored.githubWebhookSecret);
    } catch {
      this.logger.error(`Secret de webhook illisible pour le projet ${projectId}.`);
      throw this.unauthorized();
    }
    if (!verifyGitHubSignature(secret, rawBody, signature)) throw this.unauthorized();

    // Le JSON n'est analysé qu'une fois la signature vérifiée sur le corps brut (r44-m1) : un corps
    // refusé n'est jamais parsé
    let payload: unknown;
    try {
      payload = JSON.parse((rawBody as Buffer).toString('utf8'));
    } catch {
      throw new BadRequestException('Corps JSON invalide.');
    }
    const body = (payload && typeof payload === 'object' ? payload : {}) as GitHubPayload;
    const fullName = body.repository?.full_name;
    if (
      !stored.githubRepo ||
      typeof fullName !== 'string' ||
      fullName.toLowerCase() !== stored.githubRepo.toLowerCase()
    ) {
      throw this.unauthorized();
    }
    if (typeof deliveryId !== 'string' || !DELIVERY_ID.test(deliveryId)) throw this.unauthorized();

    const key = `github-webhook:${projectId}:${deliveryId}`;
    let first: boolean;
    try {
      first = await this.withRedisTimeout(() =>
        this.redis.setIfAbsent(key, '1', WEBHOOK_DELIVERY_TTL_SECONDS),
      );
    } catch (error) {
      // Le SET a pu aboutir alors que la réponse s'est perdue : sans nettoyage, un « Redeliver »
      // serait pris pour un rejeu et ignoré. Suppression au mieux, bornée par le même délai.
      await this.withRedisTimeout(() => this.redis.del(key)).catch(() => undefined);
      throw error;
    }
    if (!first) return []; // rejeu : ignoré

    try {
      return await this.closeTasks(projectId, body);
    } catch (error) {
      // Traitement échoué : la livraison doit pouvoir être rejouée
      await this.redis.del(key).catch(() => undefined);
      throw error;
    }
  }

  private async closeTasks(projectId: string, payload: GitHubPayload): Promise<string[]> {
    const taskIds = new Set<string>();
    const pr = payload.pull_request;
    if (payload.action === 'closed' && pr && pr.merged === true) {
      extractTaskIdsFromText(`${pr.title || ''} ${pr.body || ''}`).forEach((id) => taskIds.add(id));
    }
    if (Array.isArray(payload.commits)) {
      for (const commit of payload.commits) {
        if (commit && typeof commit.message === 'string') {
          extractTaskIdsFromText(commit.message).forEach((id) => taskIds.add(id));
        }
      }
    }
    const closed: string[] = [];
    for (const taskId of taskIds) {
      if (await this.tasksService.closeTaskFromWebhook(projectId, taskId)) closed.push(taskId);
    }
    return closed;
  }

  /**
   * Génère un nouveau secret (l'ancien cesse de valoir immédiatement) et le renvoie en clair une
   * seule fois. Droit `project.manage` : propriétaire du projet, OWNER/ADMIN de l'espace de
   * travail (MANAGER implicites) et MANAGER désignés du projet.
   */
  async regenerateSecret(projectId: string, userId: string): Promise<{ webhookSecret: string }> {
    const project = await this.policy.assertProject(projectId, userId, 'project.manage');
    if (!project.githubRepo) {
      throw new BadRequestException("Liez d'abord un dépôt GitHub à ce projet.");
    }
    const webhookSecret = generateWebhookSecret();
    await this.prisma.project.update({
      where: { id: projectId },
      data: { githubWebhookSecret: encrypt(webhookSecret) },
    });
    // Le secret n'est jamais journalisé
    await this.permissions.logAction(
      userId,
      'PROJECT_WEBHOOK_SECRET_REGENERATE',
      'Project',
      projectId,
      {
        githubRepo: project.githubRepo,
      },
    );
    return { webhookSecret };
  }

  private async withRedisTimeout<T>(operation: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Délai Redis dépassé')), this.redisTimeoutMs);
    });
    try {
      return await Promise.race([operation(), timeout]);
    } catch {
      throw new ServiceUnavailableException('Webhook momentanément indisponible, réessayez.');
    } finally {
      clearTimeout(timer);
    }
  }
}

interface GitHubPayload {
  action?: string;
  repository?: { full_name?: unknown };
  pull_request?: { merged?: boolean; title?: string; body?: string };
  commits?: Array<{ message?: unknown }>;
}
