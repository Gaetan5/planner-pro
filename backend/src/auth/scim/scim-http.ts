import {
  applyDecorators,
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { Public } from '../public.decorator';
import { ScimAuthGuard } from './scim.guard';
import {
  SCIM_IP_LIMIT,
  SCIM_WINDOW_MS,
  ScimKeyThrottlerGuard,
} from '../../common/app-throttler.guard';

export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

/** Réponses d'erreur au format SCIM (RFC 7644 §3.12) sur les routes /scim/v2. */
@Catch(HttpException)
export class ScimExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    let scimType: string | undefined;
    let detail: string;
    if (typeof body === 'object' && body !== null && 'schemas' in body) {
      // Déjà au format SCIM (erreurs levées par le service)
      response.status(status).type('application/scim+json').json(body);
      return;
    }
    if (typeof body === 'string') {
      detail = body;
    } else {
      const message = (body as { message?: string | string[] }).message;
      detail = Array.isArray(message) ? message.join(' ; ') : (message ?? exception.message);
    }
    if (status === HttpStatus.BAD_REQUEST) scimType = 'invalidValue';

    response
      .status(status)
      .type('application/scim+json')
      .json({
        schemas: [SCIM_ERROR_SCHEMA],
        status: String(status),
        ...(scimType ? { scimType } : {}),
        detail,
      });
  }
}

/**
 * Audit de chaque opération SCIM : clé, workspace, méthode, cible et issue. Aucune adresse ni
 * donnée personnelle n'est journalisée. La persistance en base relève de l'audit global (A8).
 */
@Injectable()
export class ScimAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('ScimAudit');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & Record<string, unknown>>();
    const base = () => ({
      event: 'SCIM_OPERATION',
      workspaceId: (request.scimWorkspace as { id?: string } | undefined)?.id,
      keyId: request.scimApiKeyId,
      method: request.method,
      route: (request.route as { path?: string } | undefined)?.path,
      targetId: request.params?.id,
    });
    return next.handle().pipe(
      tap({
        next: () => this.logger.log(JSON.stringify({ ...base(), outcome: 'success' })),
        error: (error: unknown) =>
          this.logger.warn(
            JSON.stringify({
              ...base(),
              outcome: 'failure',
              status: error instanceof HttpException ? error.getStatus() : 500,
            }),
          ),
      }),
    );
  }
}

/**
 * Route SCIM authentifiée par clé d'API : erreurs au format SCIM, audit, limitation de débit
 * (S11-b : 3 000 requêtes par minute et par IP avant authentification, 300 par minute et par clé authentifiée `scimApiKeyId`).
 */
export const ScimEndpoint = () =>
  applyDecorators(
    Public(),
    UseGuards(ScimAuthGuard, ScimKeyThrottlerGuard),
    UseFilters(ScimExceptionFilter),
    UseInterceptors(ScimAuditInterceptor),
    // Limite par IP (garde global, avant authentification) ; la limite par clé authentifiée est dans ScimKeyThrottlerGuard
    Throttle({ default: { limit: SCIM_IP_LIMIT, ttl: SCIM_WINDOW_MS } }),
  );
