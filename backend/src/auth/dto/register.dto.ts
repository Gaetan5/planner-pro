import { IsEmail, IsString, MinLength, Matches } from 'class-validator';

/** Politique de mot de passe commune à l'inscription et à la réinitialisation. */
export const PASSWORD_POLICY = /((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/;
export const PASSWORD_MIN_LENGTH_MESSAGE = 'Le mot de passe doit contenir au moins 10 caractères.';
export const PASSWORD_POLICY_MESSAGE =
  'Le mot de passe doit contenir au moins une lettre majuscule, une lettre minuscule et un chiffre ou caractère spécial.';

export class RegisterDto {
  @IsEmail({}, { message: "L'email doit être une adresse valide." })
  email!: string;

  @MinLength(10, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  @Matches(PASSWORD_POLICY, { message: PASSWORD_POLICY_MESSAGE })
  passwordRaw!: string;

  @IsString()
  @MinLength(2, { message: 'Le nom doit contenir au moins 2 caractères.' })
  name!: string;
}
