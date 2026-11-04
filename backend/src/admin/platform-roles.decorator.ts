import { SetMetadata } from '@nestjs/common';
import { PlatformRole } from '@prisma/client';

export const PLATFORM_ROLES_KEY = 'platformRoles';

/**
 * Restreint une route d'administration à certains rôles de plateforme (S18.1). Sans décorateur,
 * tout `platformRole` non nul passe (lecture, révocation de sessions). Les routes qui changent des
 * rôles ou prennent l'identité d'un compte doivent déclarer `@PlatformRoles('SUPER_ADMIN')`.
 */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);
