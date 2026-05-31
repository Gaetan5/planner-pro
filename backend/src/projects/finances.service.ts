import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceRole } from '@prisma/client';

@Injectable()
export class FinancesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertWorkspaceRole(workspaceId: string, userId: string, allowedRoles: WorkspaceRole[]) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        workspaceId,
        userId,
        workspace: { deletedAt: null },
      },
    });
    if (!membership) {
      throw new ForbiddenException('Workspace not found or unauthorized');
    }
    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Unauthorized: insufficient workspace permissions');
    }
    return membership;
  }

  async getProjectFinances(projectId: string, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: { workspace: true, tasks: { where: { deletedAt: null } } },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    const workspaceId = project.workspaceId;
    if (!workspaceId) {
      throw new Error('Workspace not found for this project');
    }

    // Valider les droits admin / owner pour accéder aux finances
    await this.assertWorkspaceRole(workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    // Récupérer tous les TimeLogs du projet
    const timeLogs = await this.prisma.timeLog.findMany({
      where: {
        task: {
          projectId,
          deletedAt: null,
        },
        duration: { not: null },
      },
      include: {
        task: true,
      },
    });

    // Récupérer tous les profils de ressources du workspace
    const resourceProfiles = await this.prisma.resourceProfile.findMany({
      where: { workspaceId },
    });

    let totalDurationSeconds = 0;
    let actualCostCents = 0;
    let actualRevenueCents = 0;

    timeLogs.forEach((log) => {
      totalDurationSeconds += log.duration || 0;

      // Déterminer l'utilisateur auteur du log
      const logUserId = log.userId || log.task.userId;
      const profile = resourceProfiles.find((p) => p.userId === logUserId);

      const costRate = profile?.costRateCents ?? 0;
      const billingRate = profile?.billingRateCents ?? 0;

      const durationHours = (log.duration || 0) / 3600;

      actualCostCents += Math.round(durationHours * costRate);

      if (project.billingType === 'TIME_AND_MATERIALS') {
        actualRevenueCents += Math.round(durationHours * billingRate);
      }
    });

    // Si FIXED_PRICE, le revenu constaté est calculé au prorata de l'avancement moyen du projet
    if (project.billingType === 'FIXED_PRICE') {
      const budget = project.budgetCents ?? 0;
      const tasks = project.tasks;
      let averageProgress = 0;

      if (tasks.length > 0) {
        const totalProgress = tasks.reduce((sum, t) => sum + (t.progress || 0), 0);
        averageProgress = totalProgress / tasks.length;
      }

      actualRevenueCents = Math.round(budget * (averageProgress / 100));
    }

    const marginCents = actualRevenueCents - actualCostCents;
    const marginPercent = actualRevenueCents > 0 ? Math.round((marginCents / actualRevenueCents) * 100) : 0;
    
    const budget = project.budgetCents ?? 0;
    const burnPercent = budget > 0 ? Math.round((actualCostCents / budget) * 100) : 0;
    const hasBudgetAlert = budget > 0 && actualCostCents > budget;

    return {
      projectId,
      projectName: project.name,
      billingType: project.billingType,
      budgetCents: project.budgetCents,
      totalHours: Number((totalDurationSeconds / 3600).toFixed(2)),
      actualCostCents,
      actualRevenueCents,
      marginCents,
      marginPercent,
      burnPercent,
      hasBudgetAlert,
    };
  }

  async getWorkspaceFinancialSummary(workspaceId: string, userId: string) {
    await this.assertWorkspaceRole(workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    const projects = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null },
    });

    const projectSummaries = await Promise.all(
      projects.map(async (project) => {
        try {
          return await this.getProjectFinances(project.id, userId);
        } catch (e) {
          return null;
        }
      }),
    );

    const validSummaries = projectSummaries.filter((s) => s !== null);

    const totalBudget = validSummaries.reduce((sum, s) => sum + (s.budgetCents || 0), 0);
    const totalCost = validSummaries.reduce((sum, s) => sum + s.actualCostCents, 0);
    const totalRevenue = validSummaries.reduce((sum, s) => sum + s.actualRevenueCents, 0);
    const totalHours = validSummaries.reduce((sum, s) => sum + s.totalHours, 0);

    const totalMargin = totalRevenue - totalCost;
    const totalMarginPercent = totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 100) : 0;

    return {
      workspaceId,
      totalBudget,
      totalCost,
      totalRevenue,
      totalMargin,
      totalMarginPercent,
      totalHours: Number(totalHours.toFixed(2)),
      projects: validSummaries,
    };
  }
}
