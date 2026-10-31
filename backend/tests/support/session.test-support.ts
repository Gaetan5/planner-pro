import { TokenService } from '../../src/auth/token.service';

/** Identifiant de session des jetons de test fabriqués sans base. */
export const STUB_SID = 'sid-test';

/**
 * SessionService réduit à la vérification du jeton (signature, typ, sid) : pour les tests de routes
 * qui n'étudient pas le cycle de vie de la session. Le vrai service est testé dans
 * `session-lifecycle.spec.ts`.
 */
export function sessionServiceStub(tokenService: TokenService) {
  return {
    verifyAccess: (token: string) => tokenService.verifyAccessToken(token),
    isSessionActive: jest.fn().mockResolvedValue(true),
  };
}
