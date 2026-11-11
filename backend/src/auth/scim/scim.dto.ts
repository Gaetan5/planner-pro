import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { lenient } from '../../common/app-validation.pipe';

export interface ScimName {
  formatted?: string;
  familyName?: string;
  givenName?: string;
}

export interface ScimEmail {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails: ScimEmail[];
  active: boolean;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location?: string;
  };
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

// --- Corps des requêtes : classes validées (S11). Les attributs hors schéma envoyés par les IdP
// (groups, extension entreprise, meta…) sont ignorés (@lenient) au lieu d'être refusés.

@lenient()
export class ScimNameDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  formatted?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  familyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  givenName?: string;
}

@lenient()
export class ScimEmailDto {
  @IsEmail()
  @MaxLength(254)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @IsOptional()
  @IsBoolean()
  primary?: boolean;
}

@lenient()
export class CreateScimUserDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  schemas?: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  userName!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ScimNameDto)
  name?: ScimNameDto;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ScimEmailDto)
  emails?: ScimEmailDto[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalId?: string;
}

@lenient()
export class ScimPatchOperationDto {
  // Entra ID envoie « Add », « Replace », « Remove » : insensible à la casse
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn(['add', 'replace', 'remove'])
  op!: 'add' | 'replace' | 'remove';

  @IsOptional()
  @IsString()
  @MaxLength(256)
  path?: string;

  @Allow()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
}

@lenient()
export class ScimPatchRequestDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  schemas?: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ScimPatchOperationDto)
  Operations!: ScimPatchOperationDto[];
}

/** Paramètres de liste (RFC 7644 §3.4.2) : entiers validés, autres paramètres ignorés. */
@lenient()
export class ScimListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  startIndex?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  count?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  filter?: string;
}

/** Création d'une clé API SCIM : nom 1..100, expiration par défaut de 365 jours. */
export class CreateScimKeyDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  expiresInDays?: number;
}
