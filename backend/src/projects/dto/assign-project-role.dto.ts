import { IsEnum, IsUUID } from 'class-validator';
import { ProjectRole } from '@prisma/client';

export class AssignProjectRoleDto {
  @IsUUID('4', { message: "L'identifiant de la personne ciblée doit être un UUID valide." })
  targetUserId!: string;

  @IsEnum(ProjectRole, { message: 'Le rôle de projet spécifié est invalide.' })
  role!: ProjectRole;
}
