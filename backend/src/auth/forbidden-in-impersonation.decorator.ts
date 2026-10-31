import { SetMetadata } from '@nestjs/common';

export const IS_FORBIDDEN_IN_IMPERSONATION = 'isForbiddenInImpersonation';

/**
 * Interdit la route (ou tout le contrôleur) à une session d'impersonation (S18.2) : `JwtAuthGuard`
 * répond 403 quand le jeton porte `impersonatedBy`. À poser sur toute route qui pourrait donner un
 * accès persistant au compte cible (MFA, liaison GitHub/Firebase, sessions) ou qui administre.
 * Porté par la route et non par son chemin : le routage Express ignore la casse.
 */
export const ForbiddenInImpersonation = () => SetMetadata(IS_FORBIDDEN_IN_IMPERSONATION, true);
