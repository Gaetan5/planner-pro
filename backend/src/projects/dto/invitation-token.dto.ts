import { IsString, Matches } from 'class-validator';

/** Format émis par `InvitationsService.createInvitation` (`randomBytes(32).toString('hex')`). */
export const INVITATION_TOKEN_FORMAT = /^[a-f0-9]{64}$/;

/**
 * Corps de `POST /projects/invitations/check` et `/accept` (S27) : le jeton n'est plus dans le
 * chemin de l'URL, donc ni dans les journaux d'accès ni dans l'historique des intermédiaires.
 */
export class InvitationTokenDto {
  @IsString()
  @Matches(INVITATION_TOKEN_FORMAT, { message: "Lien d'invitation invalide ou expiré." })
  token!: string;
}
