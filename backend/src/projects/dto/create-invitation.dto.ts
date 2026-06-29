import { IsString, IsOptional, IsEnum, IsEmail, IsUUID, IsInt, Min } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateInvitationDto {
  @IsEmail({}, { message: "L'adresse e-mail saisie est invalide." })
  @IsOptional()
  email?: string;

  @IsEnum(WorkspaceRole, { message: "Le rôle spécifié est invalide." })
  role!: WorkspaceRole;

  @IsUUID('4', { message: "L'ID de projet doit être un UUID valide." })
  @IsOptional()
  projectId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  durationDays?: number;
}
