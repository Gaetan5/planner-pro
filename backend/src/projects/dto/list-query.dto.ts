import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

/** Plafond du nombre d'entrées d'un journal d'audit renvoyées en une requête (S23). */
export const MAX_AUDIT_LOG_LIMIT = 500;

/** `?limit=` des journaux d'audit : entier de 1 à 500 (S23). */
export class AuditLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AUDIT_LOG_LIMIT)
  limit?: number;
}

/** Fenêtre de `GET /projects/timeblocks/all` : dates ISO 8601 valides (S23). */
export class TimeRangeQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  start?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  end?: string;
}

/** Étendue maximale d'une fenêtre de créneaux : un an. */
export const MAX_TIME_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
