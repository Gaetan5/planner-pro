import { IsOptional, IsString, MinLength } from 'class-validator';

export class FirebaseLoginDto {
  @IsString()
  @MinLength(1)
  idToken!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;
}
