import { IsEmail, IsString, MinLength, Matches } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: "L'email doit être une adresse valide." })
  email: string;

  @MinLength(10, { message: 'Le mot de passe doit contenir au moins 10 caractères.' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'Le mot de passe doit contenir au moins une lettre majuscule, une lettre minuscule et un chiffre ou caractère spécial.',
  })
  passwordRaw: string;

  @IsString()
  @MinLength(2, { message: 'Le nom doit contenir au moins 2 caractères.' })
  name: string;
}
