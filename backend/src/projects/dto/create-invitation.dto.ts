import { IsOptional, IsEnum, IsEmail, IsUUID, IsInt, Min, Max } from 'class-validator';
import { ProjectRole, WorkspaceRole } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateInvitationDto {
  @IsEmail({}, { message: "L'adresse e-mail saisie est invalide." })
  @IsOptional()
  email?: string;

  /** Obligatoire hors invitation à un projet ; ignoré (VIEWER) pour une invitation à un projet. */
  @IsEnum(WorkspaceRole, { message: 'Le rôle spécifié est invalide.' })
  @IsOptional()
  role?: WorkspaceRole;

  @IsUUID('4', { message: "L'ID de projet doit être un UUID valide." })
  @IsOptional()
  projectId?: string;

  /** Rôle de l'invité sur le projet (CLIENT par défaut) ; sans effet sans `projectId`. */
  @IsEnum(ProjectRole, { message: 'Le rôle de projet spécifié est invalide.' })
  @IsOptional()
  projectRole?: ProjectRole;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30, { message: "La durée d'une invitation ne peut pas dépasser 30 jours." })
  @IsOptional()
  durationDays?: number;
}
