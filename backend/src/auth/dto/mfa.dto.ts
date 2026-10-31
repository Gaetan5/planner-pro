import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const SIX_DIGITS = /^\d{6}$/;
const SIX_DIGITS_MESSAGE = 'Le code doit contenir exactement 6 chiffres.';

/** Code TOTP à 6 chiffres (confirmation de l'activation). */
export class MfaCodeDto {
  @Matches(SIX_DIGITS, { message: SIX_DIGITS_MESSAGE })
  code!: string;
}

/** Challenge de connexion : ticket + code TOTP ou code de secours. */
export class MfaChallengeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  mfaTicket!: string;

  @IsOptional()
  @Matches(SIX_DIGITS, { message: SIX_DIGITS_MESSAGE })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  recoveryCode?: string;
}

/** Désactivation du MFA : facteur actuel (TOTP ou code de secours) ET mot de passe. */
export class DisableMfaDto {
  @IsOptional()
  @Matches(SIX_DIGITS, { message: SIX_DIGITS_MESSAGE })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  recoveryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}

/** Régénération des codes de secours : code TOTP ET mot de passe. */
export class RegenerateRecoveryCodesDto {
  @Matches(SIX_DIGITS, { message: SIX_DIGITS_MESSAGE })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}

/** Début d'activation du MFA : réauthentification par mot de passe (S6-b). */
export class SetupMfaDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}
