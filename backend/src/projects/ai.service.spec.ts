import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { GeminiService } from '../notes/gemini.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';
import { TaskPriority, TaskStatus, DependencyType } from '@prisma/client';

describe('AiService', () => {
  let service: AiService;
  let geminiService: GeminiService;
  let prisma: PrismaService;
  let projectsService: ProjectsService;

  const mockPrisma = {
    membership: {
      findMany: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
  };

  const mockGeminiService = {
    parseCommand: jest.fn(),
  };

  const mockProjectsService = {
    createTask: jest.fn(),
    updateTask: jest.fn(),
    addTaskDependency: jest.fn(),
    createTimeBlock: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: ProjectsService, useValue: mockProjectsService },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    geminiService = module.get<GeminiService>(GeminiService);
    prisma = module.get<PrismaService>(PrismaService);
    projectsService = module.get<ProjectsService>(ProjectsService);

    jest.clearAllMocks();
  });

  describe('analyzeCommand', () => {
    const userId = 'user-auth';
    const workspaceId = 'workspace-123';
    const projectId = 'project-123';

    it('devrait analyser la création de tâche et résoudre l\'assignation d\'un membre', async () => {
      mockGeminiService.parseCommand.mockResolvedValue([
        {
          type: 'CREATE_TASK',
          taskTitle: 'Maquetter la DB',
          priority: 'HIGH',
          dueDate: '2026-06-01',
          estimatedMinutes: 120,
          assigneeName: 'Alice',
        },
      ]);

      mockPrisma.membership.findMany.mockResolvedValue([
        { userId: 'alice-id', user: { id: 'alice-id', name: 'Alice Smith', email: 'alice@test.com' } },
        { userId: 'bob-id', user: { id: 'bob-id', name: 'Bob Jones', email: 'bob@test.com' } },
      ]);

      mockPrisma.task.findMany.mockResolvedValue([]);

      const result = await service.analyzeCommand(userId, workspaceId, projectId, 'Créer tâche maquetter DB pour Alice');

      expect(result).toHaveLength(1);
      const action = result[0];
      expect(action.type).toBe('CREATE_TASK');
      expect(action.taskTitle).toBe('Maquetter la DB');
      expect(action.assigneeId).toBe('alice-id');
      expect(action.assigneeName).toBe('Alice Smith');
      expect(action.resolved).toBe(true);
      expect(action.warning).toBeUndefined();
    });

    it('devrait marquer non résolu si l\'assigné est introuvable', async () => {
      mockGeminiService.parseCommand.mockResolvedValue([
        {
          type: 'CREATE_TASK',
          taskTitle: 'Tâche Test',
          assigneeName: 'Charles',
        },
      ]);

      mockPrisma.membership.findMany.mockResolvedValue([
        { userId: 'alice-id', user: { id: 'alice-id', name: 'Alice Smith', email: 'alice@test.com' } },
      ]);

      mockPrisma.task.findMany.mockResolvedValue([]);

      const result = await service.analyzeCommand(userId, workspaceId, projectId, 'créer tâche pour Charles');

      expect(result).toHaveLength(1);
      expect(result[0].resolved).toBe(false);
      expect(result[0].warning).toContain('Charles" introuvable');
    });

    it('devrait résoudre une affectation de tâche existante par similarité de titre', async () => {
      mockGeminiService.parseCommand.mockResolvedValue([
        {
          type: 'ASSIGN_TASK',
          taskTitle: 'Secu',
          assigneeName: 'Bob',
        },
      ]);

      mockPrisma.membership.findMany.mockResolvedValue([
        { userId: 'bob-id', user: { id: 'bob-id', name: 'Bob Jones', email: 'bob@test.com' } },
      ]);

      mockPrisma.task.findMany.mockResolvedValue([
        { id: 'task-sec-id', title: 'Configurer la sécurité globale' },
      ]);

      const result = await service.analyzeCommand(userId, workspaceId, projectId, 'Assigne Bob sur Secu');

      expect(result).toHaveLength(1);
      const action = result[0];
      expect(action.resolved).toBe(true);
      expect(action.taskId).toBe('task-sec-id');
      expect(action.taskTitle).toBe('Configurer la sécurité globale'); // Titre réel résolu
      expect(action.assigneeId).toBe('bob-id');
    });
  });

  describe('executeActions', () => {
    const userId = 'user-auth';
    const workspaceId = 'workspace-123';
    const projectId = 'project-123';

    it('devrait appeler createTimeBlock pour une action CREATE_TIMEBLOCK', async () => {
      const actions: any[] = [
        {
          type: 'CREATE_TIMEBLOCK',
          taskId: 'task-123',
          timeBlockStart: '2026-06-01T10:00:00Z',
          timeBlockEnd: '2026-06-01T12:00:00Z',
        },
      ];

      mockProjectsService.createTimeBlock.mockResolvedValue({ id: 'block-123' });

      const result = await service.executeActions(userId, workspaceId, projectId, actions);

      expect(result.success).toBe(true);
      expect(result.executedCount).toBe(1);
      expect(mockProjectsService.createTimeBlock).toHaveBeenCalledWith(
        'task-123',
        userId,
        new Date('2026-06-01T10:00:00Z'),
        new Date('2026-06-01T12:00:00Z'),
      );
    });

    it('devrait appeler updateTask pour une action UPDATE_TASK_STATUS', async () => {
      const actions: any[] = [
        {
          type: 'UPDATE_TASK_STATUS',
          taskId: 'task-123',
          status: 'DONE',
        },
      ];

      mockProjectsService.updateTask.mockResolvedValue({ id: 'task-123' });

      const result = await service.executeActions(userId, workspaceId, projectId, actions);

      expect(result.success).toBe(true);
      expect(result.executedCount).toBe(1);
      expect(mockProjectsService.updateTask).toHaveBeenCalledWith('task-123', userId, {
        status: 'DONE',
      });
    });
  });
});
