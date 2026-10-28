import { IsEmail, IsNotEmpty, IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { SSOProvider, WorkspaceRole } from '@prisma/client';

export class DiscoverSsoDto {
  @IsEmail({}, { message: 'Une adresse e-mail valide est requise.' })
  @IsNotEmpty({ message: "L'e-mail est obligatoire." })
  email!: string;
}

export class SsoCallbackDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  domain!: string;

  @IsString()
  @IsOptional()
  redirectUri?: string;
}

export class ConfigureSsoDto {
  @IsEnum(SSOProvider, { message: 'Fournisseur SSO invalide.' })
  provider!: SSOProvider;

  @IsString()
  @IsNotEmpty({ message: 'Le domaine de messagerie entreprise est requis (ex: acme.com).' })
  domain!: string;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  clientSecret?: string;

  @IsString()
  @IsOptional()
  discoveryUrl?: string;

  @IsString()
  @IsOptional()
  entryPoint?: string;

  @IsString()
  @IsOptional()
  cert?: string;

  @IsString()
  @IsOptional()
  issuer?: string;

  @IsEnum(WorkspaceRole)
  @IsOptional()
  defaultRole?: WorkspaceRole;

  @IsBoolean()
  @IsOptional()
  enforceSSO?: boolean;

  @IsBoolean()
  @IsOptional()
  autoProvision?: boolean;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
