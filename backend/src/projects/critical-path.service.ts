import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectPermissionsService } from './project-permissions.service';

@Injectable()
export class CriticalPathService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectPermissionsService: ProjectPermissionsService,
  ) {}

  async calculateCriticalPath(projectId: string, userId: string) {
    await this.projectPermissionsService.assertProjectRole(projectId, userId, [
      'MANAGER',
      'CONTRIBUTOR',
      'COMMENTER',
      'CLIENT',
    ]);

    const tasks = await this.prisma.task.findMany({
      where: { projectId, deletedAt: null },
      include: {
        dependencies: true,
      },
    });

    if (tasks.length === 0) {
      return { criticalTaskIds: [], slacks: {} };
    }

    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const durations = new Map<string, number>();

    tasks.forEach((task) => {
      adj.set(task.id, []);
      inDegree.set(task.id, 0);
      durations.set(task.id, task.estimatedMinutes ?? 120);
    });

    tasks.forEach((task) => {
      task.dependencies.forEach((dep) => {
        if (adj.has(dep.dependsOnTaskId)) {
          adj.get(dep.dependsOnTaskId)!.push(task.id);
          inDegree.set(task.id, inDegree.get(task.id)! + 1);
        }
      });
    });

    const queue: string[] = [];
    inDegree.forEach((degree, taskId) => {
      if (degree === 0) {
        queue.push(taskId);
      }
    });

    const topoOrder: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      topoOrder.push(u);

      const succs = adj.get(u) || [];
      succs.forEach((v) => {
        inDegree.set(v, inDegree.get(v)! - 1);
        if (inDegree.get(v) === 0) {
          queue.push(v);
        }
      });
    }

    if (topoOrder.length !== tasks.length) {
      throw new BadRequestException('Dépendances circulaires détectées (cycle)');
    }

    const ES = new Map<string, number>();
    const EF = new Map<string, number>();

    topoOrder.forEach((u) => {
      let maxPrevEF = 0;
      const currentTask = tasks.find((t) => t.id === u);
      if (currentTask) {
        currentTask.dependencies.forEach((dep) => {
          if (EF.has(dep.dependsOnTaskId)) {
            maxPrevEF = Math.max(maxPrevEF, EF.get(dep.dependsOnTaskId)!);
          }
        });
      }

      ES.set(u, maxPrevEF);
      EF.set(u, maxPrevEF + durations.get(u)!);
    });

    let maxEF = 0;
    EF.forEach((val) => {
      if (val > maxEF) maxEF = val;
    });

    const LS = new Map<string, number>();
    const LF = new Map<string, number>();

    for (let i = topoOrder.length - 1; i >= 0; i--) {
      const u = topoOrder[i];
      const succs = adj.get(u) || [];

      if (succs.length === 0) {
        LF.set(u, maxEF);
      } else {
        let minSuccLS = Infinity;
        succs.forEach((v) => {
          if (LS.has(v)) {
            minSuccLS = Math.min(minSuccLS, LS.get(v)!);
          }
        });
        LF.set(u, minSuccLS);
      }

      LS.set(u, LF.get(u)! - durations.get(u)!);
    }

    const slacks: Record<string, number> = {};
    const criticalTaskIds: string[] = [];

    tasks.forEach((task) => {
      const u = task.id;
      const slack = LF.get(u)! - EF.get(u)!;
      slacks[u] = slack;
      if (Math.abs(slack) < 0.001) {
        criticalTaskIds.push(u);
      }
    });

    return {
      criticalTaskIds,
      slacks,
    };
  }
}
