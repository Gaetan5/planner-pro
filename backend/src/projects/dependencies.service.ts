import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DependencyType } from '@prisma/client';
import { FirestoreSyncService } from '../firestore-sync/firestore-sync.service';

@Injectable()
export class DependenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firestoreSync: FirestoreSyncService,
  ) {}

  private async hasPath(
    startTaskId: string,
    targetTaskId: string,
    visited: Set<string>,
  ): Promise<boolean> {
    if (startTaskId === targetTaskId) return true;
    if (visited.has(startTaskId)) return false;
    visited.add(startTaskId);

    const dependencies = await this.prisma.taskDependency.findMany({
      where: { taskId: startTaskId },
    });

    for (const dep of dependencies) {
      if (await this.hasPath(dep.dependsOnTaskId, targetTaskId, visited)) {
        return true;
      }
    }

    return false;
  }

  private async assertTaskAccess(taskId: string, userId: string) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
        OR: [{ userId }, { project: { workspace: { memberships: { some: { userId } } } } }],
      },
    });
    if (!task) {
      throw new BadRequestException('Task not found or unauthorized');
    }
    return task;
  }

  async addTaskDependency(
    taskId: string,
    userId: string,
    dependsOnTaskId: string,
    type: DependencyType = DependencyType.FINISH_TO_START,
  ) {
    if (taskId === dependsOnTaskId) {
      throw new BadRequestException('A task cannot depend on itself');
    }

    const [task, dependsOnTask] = await Promise.all([
      this.prisma.task.findFirst({
        where: {
          id: taskId,
          deletedAt: null,
          OR: [{ userId }, { project: { workspace: { memberships: { some: { userId } } } } }],
        },
        include: { project: { select: { workspaceId: true } } },
      }),
      this.prisma.task.findFirst({
        where: {
          id: dependsOnTaskId,
          deletedAt: null,
          OR: [{ userId }, { project: { workspace: { memberships: { some: { userId } } } } }],
        },
        include: { project: { select: { workspaceId: true } } },
      }),
    ]);

    if (!task || !dependsOnTask || task.projectId !== dependsOnTask.projectId) {
      throw new BadRequestException(
        'Dependency tasks not found, unauthorized, or not in the same project',
      );
    }

    // Vérifier si dependsOnTaskId dépend déjà de taskId (ce qui créerait un cycle)
    const isCyclic = await this.hasPath(dependsOnTaskId, taskId, new Set<string>());
    if (isCyclic) {
      throw new BadRequestException(
        'Creating this dependency would create a cycle (circular dependency detected)',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.taskDependency.create({
        data: { taskId, dependsOnTaskId, type },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'taskDependency',
        entityId: created.id,
        workspaceId: task.project?.workspaceId ?? `personal-${task.userId}`,
        operation: 'upsert',
        payload: {
          id: created.id,
          taskId: created.taskId,
          dependsOnTaskId: created.dependsOnTaskId,
          projectId: task.projectId,
          type: created.type,
          createdAt: created.createdAt.toISOString(),
        },
      });
      return created;
    });
  }

  async removeTaskDependency(taskId: string, userId: string, dependsOnTaskId: string) {
    const dependency = await this.prisma.taskDependency.findFirst({
      where: {
        taskId,
        dependsOnTaskId,
        task: {
          deletedAt: null,
          OR: [{ userId }, { project: { workspace: { memberships: { some: { userId } } } } }],
        },
      },
    });
    if (!dependency) {
      throw new Error('Dependency not found or unauthorized');
    }

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.taskDependency.delete({ where: { id: dependency.id } });
      const task = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
        select: {
          id: true,
          projectId: true,
          userId: true,
          project: { select: { workspaceId: true } },
        },
      });
      await this.firestoreSync.enqueue(tx, {
        entityType: 'taskDependency',
        entityId: deleted.id,
        workspaceId: task.project?.workspaceId ?? `personal-${task.userId}`,
        operation: 'delete',
        payload: {
          id: deleted.id,
          taskId: deleted.taskId,
          dependsOnTaskId: deleted.dependsOnTaskId,
          projectId: task.projectId,
          type: deleted.type,
          createdAt: deleted.createdAt.toISOString(),
        },
      });
      return deleted;
    });
  }
}
