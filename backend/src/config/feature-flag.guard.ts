import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlag, isFeatureEnabled } from './features';

export const REQUIRED_FEATURE_KEY = 'requiredFeature';

/**
 * Associe un contrôleur ou une route à un interrupteur de fonctionnalité.
 * À combiner avec `@UseGuards(FeatureFlagGuard)` au niveau de la classe, pour que la
 * vérification passe avant les guards d'authentification des routes.
 */
export const RequireFeature = (flag: FeatureFlag) => SetMetadata(REQUIRED_FEATURE_KEY, flag);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const flag = this.reflector.getAllAndOverride<FeatureFlag | undefined>(REQUIRED_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (flag && !isFeatureEnabled(flag)) {
      // 404 : une fonctionnalité désactivée ne doit pas révéler son existence
      throw new NotFoundException();
    }
    return true;
  }
}
