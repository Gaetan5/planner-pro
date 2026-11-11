import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Corps de `POST /projects/workspaces/:workspaceId/calendar/oauth/callback` (S23). */
export class CalendarOAuthCallbackDto {
  @IsIn(['GOOGLE_CALENDAR', 'OUTLOOK'])
  provider!: 'GOOGLE_CALENDAR' | 'OUTLOOK';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  code!: string;
}
