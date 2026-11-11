import { BadRequestException, ParseEnumPipe, ParseUUIDPipe } from '@nestjs/common';

/**
 * Pipe des identifiants de ressource dans l'URL (S23) : tous les identifiants sont des UUID
 * (`@default(uuid())` du schéma). Un identifiant mal formé est refusé en 400 avant tout accès à la
 * base ou à la politique d'autorisation.
 */
export const UuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Identifiant invalide.'),
});

/** Pipe d'un paramètre d'URL pris dans une énumération : valeur hors énumération refusée en 400. */
export const enumPipe = <T extends Record<string, string>>(enumType: T, label: string) =>
  new ParseEnumPipe(enumType, {
    exceptionFactory: () => new BadRequestException(`${label} invalide.`),
  });

/** UUID facultatif dans la query string (absent : accepté ; présent mais mal formé : 400). */
export const OptionalUuidPipe = new ParseUUIDPipe({
  optional: true,
  exceptionFactory: () => new BadRequestException('Identifiant invalide.'),
});

/** `POST /projects/sprints/:sprintId/tasks` accepte aussi `backlog` (retrait du sprint). */
export const SprintOrBacklogPipe = {
  transform(value: string): string {
    return value === 'backlog' ? value : (UuidPipe.transform(value, { type: 'param' }) as never);
  },
};
