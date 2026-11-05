import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const SIX_DIGITS = /^\d{6}$/;
const SIX_DIGITS_MESSAGE = 'Le code doit contenir exactement 6 chiffres.';

/**
 * Preuve de réauthentification pour lier ou délier une identité (S31) : mot de passe (comptes qui
 * en ont un), plus un code TOTP ou un code de secours si la MFA est active.
 */
export class IdentityReauthDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  @IsOptional()
  @Matches(SIX_DIGITS, { message: SIX_DIGITS_MESSAGE })
  mfaCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  recoveryCode?: string;
}

/** Corps de `POST /auth/firebase/link`. */
export class FirebaseLinkDto extends IdentityReauthDto {
  @IsString()
  @MinLength(1)
  idToken!: string;
}

/** Corps de `POST /auth/github/link` : `code` et `state` viennent de la redirection OAuth. */
export class GithubLinkDto extends IdentityReauthDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  state!: string;
}

/** Corps de `POST /auth/firebase/unlink` et `/auth/github/unlink`. */
export class IdentityUnlinkDto extends IdentityReauthDto {}
