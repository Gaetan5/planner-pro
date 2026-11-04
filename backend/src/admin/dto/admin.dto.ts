import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PlatformRole } from '@prisma/client';

export class AdminPaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @IsOptional()
  @IsString()
  search?: string;
}

export class UpdateUserRoleDto {
  @IsOptional()
  @IsEnum(PlatformRole, {
    message: 'Le rôle doit être SUPER_ADMIN, PLATFORM_ADMIN ou null.',
  })
  role?: PlatformRole | null;
}

/** Motif obligatoire d'une impersonation (S18.2), conservé dans le journal d'audit de la plateforme. */
export class ImpersonateUserDto {
  @IsString({ message: "Le motif de l'impersonation est obligatoire." })
  @Length(10, 500, {
    message: "Le motif de l'impersonation doit comporter entre 10 et 500 caractères.",
  })
  reason!: string;
}
