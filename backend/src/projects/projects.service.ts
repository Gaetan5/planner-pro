import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotesService } from '../notes/notes.service';
import { IntegrationService } from './integration.service';
import { TasksService } from './tasks.service';
import { DependenciesService } from './dependencies.service';
import { TimeBlocksService } from './timeblocks.service';
import { MilestonesService } from './milestones.service';
import { ResourcesService } from './resources.service';
import { FinancesService } from './finances.service';
import { Prisma, TaskPriority, ProjectStatus, DeliverableStatus, DependencyType, DeliveryStatus, WorkspaceRole, TaskStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

/**
 * ProjectsService — Façade d'Orchestration
 * 
 * Responsabilités propres : Workspace, Memberships, Projects CRUD, GitHub Webhooks.
 * Délègue aux sous-services spécialisés pour tâches, dépendances, timeblocks, jalons, ressources, finances.
 * 
 * Expose des méthodes de délégation pour compatibilité ascendante avec le contrôleur et l'AiService.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notesService: NotesService,
    private readonly integrationService: IntegrationService,
    private readonly tasksService: TasksService,
    private readonly dependenciesService: DependenciesService,
    private readonly timeBlocksService: TimeBlocksService,
    private readonly milestonesService: MilestonesService,
    private readonly resourcesService: ResourcesService,
    private readonly financesService: FinancesService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════
  //  WORKSPACE & MEMBERSHIP (logique propre)
  // ═══════════════════════════════════════════════════════════════════

  private async ensureDefaultWorkspace(userId: string) {
    const existingMembership = await this.prisma.membership.findFirst({
      where: {
        userId,
        workspace: { deletedAt: null },
      },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    if (existingMembership?.workspace) {
      return existingMembership.workspace;
    }

    return this.prisma.workspace.create({
      data: {
        name: 'Espace principal',
        ownerId: userId,
        memberships: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
    });
  }

  private async assertWorkspaceMember(workspaceId: string, userId: string) {
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

    return membership;
  }

  private async assertWorkspaceRole(workspaceId: string, userId: string, allowedRoles: WorkspaceRole[]) {
    const membership = await this.assertWorkspaceMember(workspaceId, userId);
    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Unauthorized: insufficient workspace permissions');
    }
    return membership;
  }

  async getWorkspaces(userId: string) {
    await this.ensureDefaultWorkspace(userId);
    return this.prisma.workspace.findMany({
      where: {
        deletedAt: null,
        memberships: { some: { userId } },
      },
      include: {
        memberships: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        teams: { where: { deletedAt: null } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getWorkspaceMembers(userId: string, workspaceId?: string) {
    const workspace = workspaceId ? { id: workspaceId } : await this.ensureDefaultWorkspace(userId);
    await this.assertWorkspaceMember(workspace.id, userId);

    return this.prisma.membership.findMany({
      where: { workspaceId: workspace.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PROJECTS CRUD (logique propre)
  // ═══════════════════════════════════════════════════════════════════

  async createProject(
    userId: string,
    name: string,
    description?: string,
    workspaceId?: string,
    status: ProjectStatus = ProjectStatus.PLANNING,
    startDate?: string,
    dueDate?: string,
    budgetCents?: number,
    billingType?: string,
  ) {
    const workspace = workspaceId ? { id: workspaceId } : await this.ensureDefaultWorkspace(userId);
    const membership = await this.assertWorkspaceMember(workspace.id, userId);
    if (membership.role === WorkspaceRole.VIEWER) {
      throw new ForbiddenException('Unauthorized: read-only access (VIEWER)');
    }

    return this.prisma.project.create({
      data: {
        name,
        description,
        userId,
        workspaceId: workspace.id,
        status,
        startDate: startDate ? new Date(startDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        budgetCents: budgetCents !== undefined ? budgetCents : null,
        billingType: billingType !== undefined ? billingType : 'TIME_AND_MATERIALS',
      },
    });
  }

  async getProjects(userId: string) {
    await this.ensureDefaultWorkspace(userId);
    return this.prisma.project.findMany({
      where: {
        deletedAt: null,
        OR: [
          { userId },
          { workspace: { memberships: { some: { userId } } } },
        ],
      },
      include: {
        workspace: true,
        phases: { orderBy: { order: 'asc' } },
        milestones: { orderBy: { dueDate: 'asc' } },
        deliverables: { orderBy: { dueDate: 'asc' } },
        deliveries: { include: { checklist: true }, orderBy: { createdAt: 'desc' } },
        tasks: {
          where: { deletedAt: null },
          include: {
            assignees: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
            dependencies: { include: { dependsOnTask: true } },
            dependents: { include: { task: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getProject(projectId: string, userId: string) {
    return this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        OR: [
          { userId },
          { workspace: { memberships: { some: { userId } } } },
        ],
      },
      include: {
        workspace: true,
        phases: { orderBy: { order: 'asc' } },
        milestones: { orderBy: { dueDate: 'asc' } },
        deliverables: { orderBy: { dueDate: 'asc' } },
        deliveries: { include: { checklist: true }, orderBy: { createdAt: 'desc' } },
        tasks: {
          where: { deletedAt: null },
          include: {
            assignees: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
            dependencies: { include: { dependsOnTask: true } },
            dependents: { include: { task: true } },
          },
        },
      },
    });
  }

  async updateProject(projectId: string, userId: string, data: UpdateProjectDto) {
    const project = await this.getProject(projectId, userId);
    if (!project) {
      throw new Error('Project not found or unauthorized');
    }

    if (project.workspaceId) {
      const membership = await this.assertWorkspaceMember(project.workspaceId, userId);
      if (membership.role === WorkspaceRole.VIEWER) {
        throw new ForbiddenException('Unauthorized: read-only access (VIEWER)');
      }
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.startDate !== undefined ? { startDate: new Date(data.startDate) } : {}),
        ...(data.dueDate !== undefined ? { dueDate: new Date(data.dueDate) } : {}),
        ...(data.budgetCents !== undefined ? { budgetCents: data.budgetCents } : {}),
        ...(data.billingType !== undefined ? { billingType: data.billingType } : {}),
      },
    });
  }

  async deleteProject(projectId: string, userId: string) {
    const project = await this.getProject(projectId, userId);
    if (!project) {
      throw new Error('Project not found or unauthorized');
    }

    if (project.workspaceId) {
      const membership = await this.assertWorkspaceMember(project.workspaceId, userId);
      if (membership.role === WorkspaceRole.VIEWER) {
        throw new ForbiddenException('Unauthorized: read-only access (VIEWER)');
      }
    }

    await this.prisma.task.updateMany({
      where: { projectId },
      data: { deletedAt: new Date() },
    });
    return this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  GITHUB WEBHOOKS (logique propre)
  // ═══════════════════════════════════════════════════════════════════

  private verifyGitHubSignature(payload: any, signature?: string): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      return true;
    }
    if (!signature) {
      return false;
    }
    try {
      const hmac = crypto.createHmac('sha256', secret);
      const bodyStr = JSON.stringify(payload);
      const digest = 'sha256=' + hmac.update(bodyStr).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
    } catch (e) {
      return false;
    }
  }

  private extractTaskIdsFromText(text: string): string[] {
    if (!text) return [];
    const regex = /(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\s+#([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/gi;
    const taskIds: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      taskIds.push(match[1]);
    }
    return taskIds;
  }

  async handleGitHubWebhook(payload: any, signature?: string): Promise<string[]> {
    if (!this.verifyGitHubSignature(payload, signature)) {
      throw new ForbiddenException('Signature webhook GitHub invalide');
    }

    const taskIdsToClose = new Set<string>();

    if (payload.action === 'closed' && payload.pull_request) {
      const pr = payload.pull_request;
      if (pr.merged === true) {
        const textToSearch = `${pr.title || ''} ${pr.body || ''}`;
        const ids = this.extractTaskIdsFromText(textToSearch);
        ids.forEach(id => taskIdsToClose.add(id));
      }
    }

    if (payload.commits && Array.isArray(payload.commits)) {
      for (const commit of payload.commits) {
        if (commit.message) {
          const ids = this.extractTaskIdsFromText(commit.message);
          ids.forEach(id => taskIdsToClose.add(id));
        }
      }
    }

    const closedIds: string[] = [];
    for (const taskId of taskIdsToClose) {
      const success = await this.tasksService.closeTaskFromWebhook(taskId);
      if (success) {
        closedIds.push(taskId);
      }
    }

    return closedIds;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  DÉLÉGATION AUX SOUS-SERVICES (compatibilité ascendante)
  // ═══════════════════════════════════════════════════════════════════

  // --- Tasks ---
  createTask(projectId: string, userId: string, title: string, description?: string, priority?: TaskPriority, options?: any) {
    return this.tasksService.createTask(projectId, userId, title, description, priority, options);
  }
  getTasks(projectId: string, userId: string) {
    return this.tasksService.getTasks(projectId, userId);
  }
  updateTask(taskId: string, userId: string, data: UpdateTaskDto) {
    return this.tasksService.updateTask(taskId, userId, data);
  }
  deleteTask(taskId: string, userId: string) {
    return this.tasksService.deleteTask(taskId, userId);
  }

  // --- Dependencies ---
  addTaskDependency(taskId: string, userId: string, dependsOnTaskId: string, type?: DependencyType) {
    return this.dependenciesService.addTaskDependency(taskId, userId, dependsOnTaskId, type);
  }
  removeTaskDependency(taskId: string, userId: string, dependsOnTaskId: string) {
    return this.dependenciesService.removeTaskDependency(taskId, userId, dependsOnTaskId);
  }

  // --- TimeBlocks ---
  createTimeBlock(taskId: string, userId: string, startTime: Date, endTime: Date) {
    return this.timeBlocksService.createTimeBlock(taskId, userId, startTime, endTime);
  }
  getTimeBlocks(userId: string, start?: Date, end?: Date) {
    return this.timeBlocksService.getTimeBlocks(userId, start, end);
  }
  updateTimeBlock(timeBlockId: string, userId: string, startTime: Date, endTime: Date) {
    return this.timeBlocksService.updateTimeBlock(timeBlockId, userId, startTime, endTime);
  }
  deleteTimeBlock(timeBlockId: string, userId: string) {
    return this.timeBlocksService.deleteTimeBlock(timeBlockId, userId);
  }

  // --- Milestones & Governance ---
  createMilestone(projectId: string, userId: string, name: string, description?: string, dueDate?: string) {
    return this.milestonesService.createMilestone(projectId, userId, name, description, dueDate);
  }
  completeMilestone(milestoneId: string, userId: string) {
    return this.milestonesService.completeMilestone(milestoneId, userId);
  }
  createDeliverable(projectId: string, userId: string, title: string, description?: string, status?: DeliverableStatus, dueDate?: string) {
    return this.milestonesService.createDeliverable(projectId, userId, title, description, status, dueDate);
  }
  updateDeliverableStatus(deliverableId: string, userId: string, status: DeliverableStatus) {
    return this.milestonesService.updateDeliverableStatus(deliverableId, userId, status);
  }
  createDelivery(projectId: string, userId: string, summary?: string, checklist?: string[]) {
    return this.milestonesService.createDelivery(projectId, userId, summary, checklist);
  }
  updateDeliveryStatus(deliveryId: string, userId: string, status: DeliveryStatus) {
    return this.milestonesService.updateDeliveryStatus(deliveryId, userId, status);
  }
  toggleDeliveryChecklistItem(itemId: string, userId: string) {
    return this.milestonesService.toggleDeliveryChecklistItem(itemId, userId);
  }
  getDeliveryReport(projectId: string, userId: string) {
    return this.milestonesService.getDeliveryReport(projectId, userId);
  }

  // --- Resources ---
  getResourceCapacityReport(userId: string, workspaceId?: string) {
    return this.resourcesService.getResourceCapacityReport(userId, workspaceId);
  }
  updateResourceProfile(actingUserId: string, memberUserId: string, data: any, workspaceId?: string) {
    return this.resourcesService.updateResourceProfile(actingUserId, memberUserId, data, workspaceId);
  }
  createResourceAllocation(projectId: string, actingUserId: string, userId: string, allocationPercent: number, roleLabel?: string, startDate?: string, endDate?: string) {
    return this.resourcesService.createResourceAllocation(projectId, actingUserId, userId, allocationPercent, roleLabel, startDate, endDate);
  }
  optimizeWorkspaceResources(workspaceId: string, userId: string) {
    return this.resourcesService.optimizeWorkspaceResources(workspaceId, userId);
  }

  // --- Finances ---
  getProjectFinances(projectId: string, userId: string) {
    return this.financesService.getProjectFinances(projectId, userId);
  }
  getWorkspaceFinancialSummary(workspaceId: string, userId: string) {
    return this.financesService.getWorkspaceFinancialSummary(workspaceId, userId);
  }
}
