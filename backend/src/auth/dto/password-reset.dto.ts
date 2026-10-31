import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MIN_LENGTH_MESSAGE,
  PASSWORD_POLICY,
  PASSWORD_POLICY_MESSAGE,
} from './register.dto';

/** Corps de `POST /auth/email/verify` (P6). */
export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;
}

/** Corps de `POST /auth/email/resend` et `POST /auth/password/forgot` (P6). */
export class EmailOnlyDto {
  @IsEmail({}, { message: "L'email doit être une adresse valide." })
  @MaxLength(254)
  email!: string;
}

/** Corps de `POST /auth/password/reset` : même politique de mot de passe qu'à l'inscription. */
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;

  @MinLength(10, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  @MaxLength(256)
  @Matches(PASSWORD_POLICY, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;
}
