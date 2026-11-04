import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** Corps de `POST /projects/sprints/:sprintId/tasks` (S13) : au plus 200 identifiants de tâches. */
export class AssociateTasksDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  taskIds!: string[];
}
