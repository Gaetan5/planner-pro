import { IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * Champs texte des envois multipart `POST /projects/ai/voice` et `/vision` (S23). Le fichier est
 * traité par `FileInterceptor` ; seuls ces champs passent par le `ValidationPipe`.
 * `isMock` est conservé tel quel jusqu'à S26 (qui le supprime).
 */
export class AiMediaFieldsDto {
  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  isMock?: string;
}
