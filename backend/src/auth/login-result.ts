import { IssuedSession } from './session.service';

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  platformRole: string | null;
}

/** Connexion aboutie : la session est posée en cookies par le contrôleur, jamais dans le corps. */
export interface SessionLoginResult {
  user: PublicUser;
  session: IssuedSession;
}

/** Second facteur requis : un ticket à usage unique est renvoyé à la place de la session. */
export interface MfaLoginResult {
  mfaRequired: true;
  mfaTicket: string;
  user: { id: string; email: string };
}

export type LoginResult = SessionLoginResult | MfaLoginResult;

export function isMfaResult(result: LoginResult): result is MfaLoginResult {
  return 'mfaRequired' in result;
}
