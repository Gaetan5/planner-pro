import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';

/** DTO qui acceptent des attributs hors schéma (ex. corps SCIM envoyés par les IdP). */
export const LENIENT_DTO = 'lenientDto';
export const lenient = () => (target: object) => {
  Reflect.defineMetadata(LENIENT_DTO, true, target);
};

/**
 * Pipe de validation global : strict (propriétés inconnues refusées) sauf pour les DTO marqués
 * `@lenient()`, dont les propriétés inconnues sont ignorées (retirées) au lieu d'être refusées (S11).
 */
export class AppValidationPipe extends ValidationPipe {
  private readonly lenientPipe = new ValidationPipe({ whitelist: true, transform: true });

  constructor() {
    super({ whitelist: true, forbidNonWhitelisted: true });
  }

  async transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.metatype && Reflect.getOwnMetadata(LENIENT_DTO, metadata.metatype)) {
      return this.lenientPipe.transform(value, metadata);
    }
    return super.transform(value, metadata);
  }
}
