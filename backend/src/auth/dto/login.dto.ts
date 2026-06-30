import { IsEmail, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: "L'email doit être une adresse valide." })
  email: string;

  @MinLength(10, { message: 'Le mot de passe doit contenir au moins 10 caractères.' })
  passwordRaw: string;
}
