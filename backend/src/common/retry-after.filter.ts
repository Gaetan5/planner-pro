import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { TooManyAttemptsException } from '../auth/account-lockout';

/**
 * 429 par compte (verrouillage, limite par minute) : même corps que l'exception Nest d'origine,
 * plus l'en-tête `Retry-After` (secondes) que les clients et les proxys exploitent (P7).
 */
@Catch(TooManyAttemptsException)
export class RetryAfterFilter implements ExceptionFilter {
  catch(exception: TooManyAttemptsException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(exception.getStatus())
      .set('Retry-After', String(Math.max(1, exception.retryAfterSeconds)))
      .json({ statusCode: exception.getStatus(), message: exception.message });
  }
}
