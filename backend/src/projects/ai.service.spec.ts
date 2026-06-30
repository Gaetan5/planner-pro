import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';
describe('AiService', () => {
  let service: AiService;

  const mockPrisma = {
    membership: {
      findMany: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
    aiCommandHistory: {
      create: jest.fn(),
    },
  };

  const mockAiProvider = {
    parseCommand: jest.fn(),
    transcribeAudio: jest.fn(),
    analyzeImage: jest.fn(),
    isAvailable: jest.fn().mockReturnValue(true),
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
        { provide: ProjectsService, useValue: mockProjectsService },
        { provide: 'AI_PROVIDER', useValue: mockAiProvider },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    jest.clearAllMocks();
  });

  describe('analyzeCommand', () => {
    const userId = 'user-auth';
    const workspaceId = 'workspace-123';
    const projectId = 'project-123';

    it("devrait analyser la création de tâche et résoudre l'assignation d'un membre", async () => {
      mockAiProvider.parseCommand.mockResolvedValue([
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
        {
          userId: 'alice-id',
          user: { id: 'alice-id', name: 'Alice Smith', email: 'alice@test.com' },
        },
      ]);

      mockPrisma.task.findMany.mockResolvedValue([]);

      const result = await service.analyzeCommand(
        userId,
        workspaceId,
        projectId,
        'Créer tâche maquetter DB pour Alice',
      );

      expect(result).toHaveLength(1);
      const action = result[0];
      expect(action.type).toBe('CREATE_TASK');
      expect(action.taskTitle).toBe('Maquetter la DB');
      expect(action.assigneeId).toBe('alice-id');
      expect(action.resolved).toBe(true);
    });
  });
});
