import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  /** Session du jeton d'accès (S7). */
  sid?: string;
  /** Administrateur à l'origine d'une session d'impersonation. */
  impersonatedBy?: string;
}

export const User = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
