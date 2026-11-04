/**
 * Charge utile du miroir Firestore d'une tâche (`entityType: 'task'`), partagée par les services qui
 * créent, modifient ou suppriment des tâches (tâches, notes) pour que le format reste unique (O8).
 */
export function taskSyncPayload(
  task: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    priority: string;
    status: string;
    startDate: Date | null;
    dueDate: Date | null;
    estimatedMinutes: number | null;
    progress: number;
    labels: string | null;
    storyPoints: number | null;
    sprintId: string | null;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  },
  assigneeIds: string[],
) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    startDate: task.startDate?.toISOString() ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    estimatedMinutes: task.estimatedMinutes,
    progress: task.progress,
    labels: task.labels,
    storyPoints: task.storyPoints,
    sprintId: task.sprintId,
    userId: task.userId,
    assigneeIds,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    deletedAt: task.deletedAt?.toISOString() ?? null,
  };
}
