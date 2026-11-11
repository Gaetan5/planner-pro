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
  @MaxLength(254)
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
  @MaxLength(191)
  domain!: string;

  @IsString()
  @IsOptional()
  @MaxLength(191)
  clientId?: string;

  @IsString()
  @IsOptional()
  // Colonne VARCHAR(191) qui stocke le secret chiffré (`iv:tag:contenu` en hexadécimal, 58 + 2 n
  // caractères pour n octets) : 66 octets au plus, sinon la base refuse l'écriture (500)
  @MaxLength(66)
  clientSecret?: string;

  @IsString()
  @IsOptional()
  @MaxLength(191)
  discoveryUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(191)
  entryPoint?: string;

  @IsString()
  @IsOptional()
  @MaxLength(16_000)
  cert?: string;

  @IsString()
  @IsOptional()
  @MaxLength(191)
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
