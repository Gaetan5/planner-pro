import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotesService } from '../notes/notes.service';
import { IntegrationService } from './integration.service';
import * as crypto from 'crypto';

describe('ProjectsService - GitHub Webhooks', () => {
  let service: ProjectsService;
  let prisma: PrismaService;
  let notesService: NotesService;

  const mockPrisma = {
    task: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    membership: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    resourceProfile: {
      findMany: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    taskAssignee: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockNotesService = {
    syncTaskStatusToNote: jest.fn(),
  };

  const mockIntegration = {
    sendNotification: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotesService, useValue: mockNotesService },
        { provide: IntegrationService, useValue: mockIntegration },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    prisma = module.get<PrismaService>(PrismaService);
    notesService = module.get<NotesService>(NotesService);

    jest.clearAllMocks();
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  describe('verifyGitHubSignature', () => {
    it('devrait retourner true si aucun secret GITHUB_WEBHOOK_SECRET n\'est défini', async () => {
      // @ts-ignore - accès à une méthode privée pour le test
      const result = service.verifyGitHubSignature({ foo: 'bar' }, 'any-sig');
      expect(result).toBe(true);
    });

    it('devrait retourner false si le secret est défini mais que la signature est absente', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'secret';
      // @ts-ignore
      const result = service.verifyGitHubSignature({ foo: 'bar' });
      expect(result).toBe(false);
    });

    it('devrait retourner true si la signature correspond au HMAC SHA-256 du payload', async () => {
      const secret = 'my-webhook-secret';
      process.env.GITHUB_WEBHOOK_SECRET = secret;
      const payload = { event: 'push', repo: 'planner-pro' };
      const bodyStr = JSON.stringify(payload);
      const hmac = crypto.createHmac('sha256', secret);
      const digest = 'sha256=' + hmac.update(bodyStr).digest('hex');

      // @ts-ignore
      const result = service.verifyGitHubSignature(payload, digest);
      expect(result).toBe(true);
    });

    it('devrait retourner false si la signature ne correspond pas', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'secret';
      // @ts-ignore
      const result = service.verifyGitHubSignature({ foo: 'bar' }, 'sha256=invalid-signature');
      expect(result).toBe(false);
    });
  });

  describe('extractTaskIdsFromText', () => {
    it('devrait extraire les UUIDs précédés des mots-clés de fermeture', () => {
      const taskId1 = 'b406e122-37b4-4b5c-b171-d68a9fdfc418';
      const taskId2 = 'c1234567-89ab-cdef-0123-456789abcdef';
      const text = `Ce commit fixes #${taskId1} et closes #${taskId2}. Ne devrait pas matcher un simple UUID ${taskId1} ou un mot-clé sans hash comme fix #${taskId1.substring(0, 10)}`;
      
      // @ts-ignore
      const result = service.extractTaskIdsFromText(text);
      expect(result).toContain(taskId1);
      expect(result).toContain(taskId2);
      expect(result).toHaveLength(2);
    });

    it('devrait être insensible à la casse pour les mots-clés', () => {
      const taskId = 'b406e122-37b4-4b5c-b171-d68a9fdfc418';
      const text = `FIXES #${taskId} et ClOsEd #${taskId}`;
      // @ts-ignore
      const result = service.extractTaskIdsFromText(text);
      expect(result).toContain(taskId);
    });
  });

  describe('handleGitHubWebhook', () => {
    const mockTaskId = '123e4567-e89b-12d3-a456-426614174000';

    it('devrait fermer la tâche lors d\'une fusion de PR contenant "fixes #UUID"', async () => {
      const payload = {
        action: 'closed',
        pull_request: {
          merged: true,
          title: `Ferme l'anomalie de sécurité`,
          body: `Cette PR fixes #${mockTaskId} de manière définitive.`,
        },
      };

      mockPrisma.task.findFirst.mockResolvedValue({
        id: mockTaskId,
        status: 'TODO',
        noteId: 'some-note-id',
      });
      mockPrisma.task.update.mockResolvedValue({
        id: mockTaskId,
        status: 'DONE',
      });

      const closedIds = await service.handleGitHubWebhook(payload);

      expect(closedIds).toContain(mockTaskId);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith({
        where: { id: mockTaskId, deletedAt: null },
      });
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: { status: 'DONE', progress: 100 },
      });
      expect(mockNotesService.syncTaskStatusToNote).toHaveBeenCalledWith(mockTaskId, 'DONE');
    });

    it('devrait fermer les tâches issues de messages de commits lors d\'un push', async () => {
      const payload = {
        commits: [
          { message: `Ajout des tests - closes #${mockTaskId}` },
        ],
      };

      mockPrisma.task.findFirst.mockResolvedValue({
        id: mockTaskId,
        status: 'IN_PROGRESS',
        noteId: null,
      });

      const closedIds = await service.handleGitHubWebhook(payload);

      expect(closedIds).toContain(mockTaskId);
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: { status: 'DONE', progress: 100 },
      });
      // noteId est null, donc syncTaskStatusToNote ne devrait pas être appelé
      expect(mockNotesService.syncTaskStatusToNote).not.toHaveBeenCalled();
    });

    it('ne devrait rien faire si la PR est fermée sans être fusionnée', async () => {
      const payload = {
        action: 'closed',
        pull_request: {
          merged: false,
          title: `Tentative ratée de correctif`,
          body: `fixes #${mockTaskId}`,
        },
      };

      const closedIds = await service.handleGitHubWebhook(payload);
      expect(closedIds).toHaveLength(0);
      expect(mockPrisma.task.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('optimizeWorkspaceResources', () => {
    const workspaceId = 'workspace-123';
    const userId = 'user-owner';

    it('devrait jeter une erreur si le rôle de l\'utilisateur n\'est ni OWNER ni ADMIN', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({
        userId: 'user-member',
        role: 'MEMBER',
      });

      await expect(
        service.optimizeWorkspaceResources(workspaceId, 'user-member')
      ).rejects.toThrow(/Unauthorized/);
    });

    it('devrait répartir les tâches selon l\'algorithme glouton (priorité et temps)', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({
        userId,
        role: 'OWNER',
      });

      mockPrisma.membership.findMany.mockResolvedValue([
        { userId: 'dev-A', user: { id: 'dev-A', name: 'Développeur A' } },
        { userId: 'dev-B', user: { id: 'dev-B', name: 'Développeur B' } },
      ]);

      mockPrisma.resourceProfile.findMany.mockResolvedValue([
        { userId: 'dev-A', weeklyCapacityMinutes: 1000 },
        { userId: 'dev-B', weeklyCapacityMinutes: 2000 },
      ]);

      mockPrisma.task.findMany.mockResolvedValue([
        { id: 'task-1', priority: 'HIGH', estimatedMinutes: 600, assignees: [] },
        { id: 'task-2', priority: 'HIGH', estimatedMinutes: 400, assignees: [] },
        { id: 'task-3', priority: 'MEDIUM', estimatedMinutes: 500, assignees: [] },
      ]);

      mockPrisma.taskAssignee.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.taskAssignee.create.mockResolvedValue({});

      const result = await service.optimizeWorkspaceResources(workspaceId, userId);

      expect(result.success).toBe(true);
      expect(result.reallocatedCount).toBe(3);

      expect(mockPrisma.taskAssignee.create).toHaveBeenCalledWith({
        data: { taskId: 'task-1', userId: 'dev-A' },
      });
      expect(mockPrisma.taskAssignee.create).toHaveBeenCalledWith({
        data: { taskId: 'task-2', userId: 'dev-B' },
      });
      expect(mockPrisma.taskAssignee.create).toHaveBeenCalledWith({
        data: { taskId: 'task-3', userId: 'dev-B' },
      });
    });
  });
});
