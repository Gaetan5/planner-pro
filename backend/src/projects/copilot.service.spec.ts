import { Test, TestingModule } from '@nestjs/testing';
import { CopilotService } from './copilot.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../notes/gemini.service';

describe('CopilotService', () => {
  let service: CopilotService;
  let prisma: PrismaService;
  let geminiService: GeminiService;

  const mockPrisma = {
    project: {
      findMany: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
    resourceProfile: {
      findMany: jest.fn(),
    },
    membership: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    milestone: {
      findMany: jest.fn(),
    },
  };

  const mockGeminiService = {
    isAvailable: jest.fn(),
    getGenerativeModel: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CopilotService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GeminiService, useValue: mockGeminiService },
      ],
    }).compile();

    service = module.get<CopilotService>(CopilotService);
    prisma = module.get<PrismaService>(PrismaService);
    geminiService = module.get<GeminiService>(GeminiService);

    jest.clearAllMocks();
  });

  describe('calculatePredictiveAlerts', () => {
    const workspaceId = 'workspace-123';

    it('devrait détecter une tâche en retard (OVERDUE)', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 'project-1',
          tasks: [
            {
              id: 'task-overdue',
              title: 'Déployer les serveurs',
              status: 'IN_PROGRESS',
              dueDate: yesterday,
              assignees: [],
              dependencies: [],
            },
          ],
        },
      ]);

      mockPrisma.resourceProfile.findMany.mockResolvedValue([]);
      mockPrisma.membership.findMany.mockResolvedValue([]);

      const result = await service.calculatePredictiveAlerts(workspaceId);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('OVERDUE');
      expect(result[0].severity).toBe('CRITICAL');
      expect(result[0].taskId).toBe('task-overdue');
      expect(result[0].message).toContain('est en retard');
    });

    it('devrait détecter une tâche à risque (AT_RISK)', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 'project-1',
          tasks: [
            {
              id: 'task-at-risk',
              title: 'Relecture de spécification',
              status: 'TODO',
              dueDate: tomorrow,
              assignees: [],
              dependencies: [],
            },
          ],
        },
      ]);

      mockPrisma.resourceProfile.findMany.mockResolvedValue([]);
      mockPrisma.membership.findMany.mockResolvedValue([]);

      const result = await service.calculatePredictiveAlerts(workspaceId);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('AT_RISK');
      expect(result[0].severity).toBe('HIGH');
      expect(result[0].taskId).toBe('task-at-risk');
      expect(result[0].message).toContain("n'a pas encore commencé");
    });

    it('devrait détecter une tâche bloquée par une autre tâche en retard (BOTTLENECK)', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 'project-1',
          tasks: [
            {
              id: 'task-blocking',
              title: 'Rédiger l\'audit',
              status: 'IN_PROGRESS',
              dueDate: yesterday,
              assignees: [],
              dependencies: [],
            },
            {
              id: 'task-blocked',
              title: 'Soumettre au client',
              status: 'TODO',
              dueDate: null,
              assignees: [],
              dependencies: [
                {
                  dependsOnTaskId: 'task-blocking',
                  dependsOnTask: { id: 'task-blocking', title: 'Rédiger l\'audit' },
                },
              ],
            },
          ],
        },
      ]);

      mockPrisma.resourceProfile.findMany.mockResolvedValue([]);
      mockPrisma.membership.findMany.mockResolvedValue([]);

      const result = await service.calculatePredictiveAlerts(workspaceId);

      // On s'attend à 2 alertes :
      // 1. Tâche blocking en retard (OVERDUE)
      // 2. Tâche blocked bloquée par blocking (BOTTLENECK)
      expect(result.length).toBeGreaterThanOrEqual(2);
      
      const bottleneckAlert = result.find(a => a.type === 'BOTTLENECK');
      expect(bottleneckAlert).toBeDefined();
      expect(bottleneckAlert.severity).toBe('HIGH');
      expect(bottleneckAlert.taskId).toBe('task-blocked');
      expect(bottleneckAlert.message).toContain('est bloquée par "Rédiger l\'audit"');
    });

    it('devrait détecter un membre en surcharge de travail (OVERLOADED)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 'project-1',
          tasks: [
            {
              id: 'task-heavy',
              title: 'Implémenter tout le backend',
              status: 'IN_PROGRESS',
              dueDate: null,
              estimatedMinutes: 3000, // 50 heures (supérieur à la capacité de 2400)
              assignees: [{ userId: 'alice-id', user: { id: 'alice-id', name: 'Alice' } }],
              dependencies: [],
            },
          ],
        },
      ]);

      mockPrisma.resourceProfile.findMany.mockResolvedValue([
        {
          userId: 'alice-id',
          weeklyCapacityMinutes: 2400, // 40 heures
        },
      ]);

      mockPrisma.membership.findMany.mockResolvedValue([
        {
          userId: 'alice-id',
          user: { id: 'alice-id', name: 'Alice' },
        },
      ]);

      const result = await service.calculatePredictiveAlerts(workspaceId);

      const overloadAlert = result.find(a => a.type === 'OVERLOADED');
      expect(overloadAlert).toBeDefined();
      expect(overloadAlert.severity).toBe('MEDIUM');
      expect(overloadAlert.userId).toBe('alice-id');
      expect(overloadAlert.message).toContain('est en surcharge de travail');
    });
  });

  describe('generateBriefing', () => {
    const userId = 'user-123';
    const workspaceId = 'workspace-123';

    it('devrait renvoyer un briefing de démo structuré si isMock = true', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, name: 'Gaëtan' });
      mockPrisma.task.findMany.mockResolvedValue([]);
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.milestone.findMany.mockResolvedValue([]);

      const result = await service.generateBriefing(userId, workspaceId, true);

      expect(result).toContain('Bonjour Gaëtan !');
      expect(result).toContain('Aperçu de votre journée');
      expect(result).toContain('Alertes prédictives & Risques détectés');
      expect(result).toContain('Recommandations du Copilote');
    });

    it('devrait appeler Gemini et retourner sa réponse textuelle si disponible', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, name: 'Gaëtan' });
      mockPrisma.task.findMany.mockResolvedValue([
        { id: 'task-1', title: 'Faire les tests', priority: 'HIGH', project: { name: 'Projet A' } },
      ]);
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.milestone.findMany.mockResolvedValue([]);
      mockPrisma.resourceProfile.findMany.mockResolvedValue([]);
      mockPrisma.membership.findMany.mockResolvedValue([]);

      mockGeminiService.isAvailable.mockReturnValue(true);
      
      const mockGenerateContent = jest.fn().mockResolvedValue({
        response: {
          text: () => 'Voici le briefing généré par Gemini pour Gaëtan.',
        },
      });
      mockGeminiService.getGenerativeModel.mockReturnValue({
        generateContent: mockGenerateContent,
      });

      const result = await service.generateBriefing(userId, workspaceId, false);

      expect(mockGeminiService.isAvailable).toHaveBeenCalled();
      expect(mockGeminiService.getGenerativeModel).toHaveBeenCalled();
      expect(mockGenerateContent).toHaveBeenCalled();
      expect(result).toBe('Voici le briefing généré par Gemini pour Gaëtan.');
    });
  });
});
