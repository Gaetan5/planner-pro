import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class FirebaseLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  idToken!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(191)
  name?: string;
}
