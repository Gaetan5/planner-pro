import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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
