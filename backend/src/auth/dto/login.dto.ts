import { IsEmail, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: "L'email doit être une adresse valide." })
  @MaxLength(254)
  email!: string;

  @MinLength(10, { message: 'Le mot de passe doit contenir au moins 10 caractères.' })
  @MaxLength(256)
  passwordRaw!: string;
}
