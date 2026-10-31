import { Request, Response } from 'express';
import { LoginResult, isMfaResult } from './login-result';
import { setSessionCookies } from './session-cookies';

/**
 * Pose la session en cookies httpOnly (S7) et renvoie un corps sans aucun jeton.
 * Un second facteur requis renvoie le ticket MFA (usage unique) à la place.
 */
export function respondWithLogin(res: Response, result: LoginResult) {
  if (isMfaResult(result)) {
    return result;
  }
  setSessionCookies(res, result.session);
  return { user: result.user };
}

export function userAgentOf(req: Request): string | undefined {
  const header = req.headers['user-agent'];
  return typeof header === 'string' ? header : undefined;
}
