import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  MaxLength,
} from 'class-validator';
import { SSOProvider, WorkspaceRole } from '@prisma/client';

export class DiscoverSsoDto {
  @IsEmail({}, { message: 'Une adresse e-mail valide est requise.' })
  @IsNotEmpty({ message: "L'e-mail est obligatoire." })
  email!: string;
}

/** Retour de l'IdP : le domaine est retrouvé par le `state` côté serveur, jamais fourni (S10). */
export class SsoCallbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  state!: string;
}

export class SsoAuthorizeQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  domain!: string;
}

export class ConfigureSsoDto {
  // Seuls les fournisseurs réellement implémentés sont acceptés (S2) ; SAML2 et OIDC_GENERIC en Phase 2
  @IsIn([SSOProvider.OIDC_AZURE_AD, SSOProvider.OIDC_GOOGLE], {
    message: 'Fournisseur SSO non pris en charge (OIDC_AZURE_AD ou OIDC_GOOGLE).',
  })
  provider!: SSOProvider;

  @IsString()
  @IsNotEmpty({ message: 'Le domaine de messagerie entreprise est requis (ex: acme.com).' })
  domain!: string;

  @IsString()
  @IsOptional()
  @MaxLength(256)
  clientId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1024)
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

  // Jamais OWNER ni ADMIN : un IdP ne confère pas de droits d'administration (S10)
  @IsIn([WorkspaceRole.MEMBER, WorkspaceRole.VIEWER], {
    message: 'Le rôle par défaut doit être MEMBER ou VIEWER.',
  })
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
