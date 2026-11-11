import { IsString, MaxLength } from 'class-validator';

/**
 * Corps de création et de mise à jour d'une note (S23). Bornes alignées sur le schéma : `title`
 * est un VARCHAR(191) ; `content` est un TEXT (65 535 octets), 16 000 caractères tiennent même à
 * 4 octets chacun.
 */
export class NoteDto {
  @IsString()
  @MaxLength(191)
  title!: string;

  @IsString()
  @MaxLength(16_000)
  content!: string;
}
