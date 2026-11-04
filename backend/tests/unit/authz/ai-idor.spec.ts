/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PolicyService } from '../../../src/authz/policy.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { AiService } from '../../../src/projects/ai.service';
import { ExecuteAiActionsDto } from '../../../src/projects/dto/execute-ai-actions.dto';
import { ProjectsService } from '../../../src/projects/projects.service';
import { USERS, W, buildRbacPrisma } from '../../support/rbac-fixture';

/** S15 : l'IA n'opère que sur un workspace dont l'appelant est membre habilité, et sur ses projets. */
describe('S15 : AiService, contrôle d’accès', () => {
  let service: AiService;
  let prisma: ReturnType<typeof buildRbacPrisma> & Record<string, any>;
  const provider = {
    parseCommand: jest.fn(),
    transcribeAudio: jest.fn(),
    analyzeImage: jest.fn(),
    isAvailable: jest.fn().mockReturnValue(true),
  };
  const projectsService = {
    createTask: jest.fn(async () => ({ id: 'T-new' })),
    updateTask: jest.fn(),
    addTaskDependency: jest.fn(),
    createTimeBlock: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    provider.parseCommand.mockResolvedValue([{ type: 'CREATE_TASK', taskTitle: 'x' }]);
    provider.transcribeAudio.mockResolvedValue('créer tâche x');
    prisma = buildRbacPrisma() as any;
    // Les membres du workspace (avec e-mails) : liste vide ; les requêtes de la politique sont conservées
    const policyMembers = prisma.membership.findMany;
    prisma.membership.findMany = jest.fn(async (args: any) =>
      args?.include?.user ? [] : policyMembers(args),
    ) as any;
    prisma.aiCommandHistory = { create: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AiService,
        PolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projectsService },
        { provide: 'AI_PROVIDER', useValue: provider },
      ],
    }).compile();
    service = module.get(AiService);
  });

  const expectNothingRead = () => {
    expect(provider.parseCommand).not.toHaveBeenCalled();
    expect(provider.transcribeAudio).not.toHaveBeenCalled();
    expect(provider.analyzeImage).not.toHaveBeenCalled();
    expect(prisma.aiCommandHistory.create).not.toHaveBeenCalled();
    // aucune énumération des membres ni des tâches du workspace
    expect(
      prisma.membership.findMany.mock.calls.filter(([a]: any) => a?.include?.user),
    ).toHaveLength(0);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  };

  describe.each(['outsider', 'viewer'] as const)('%s', (persona) => {
    const user = USERS[persona];
    it('analyzeCommand : 403, rien n’est lu', async () => {
      await expect(service.analyzeCommand(user, W, null, 'créer tâche x')).rejects.toThrow(
        ForbiddenException,
      );
      expectNothingRead();
    });
    it('analyzeImageAndResolve : 403, Gemini non appelé', async () => {
      await expect(
        service.analyzeImageAndResolve(user, W, null, Buffer.from('x'), 'image/png'),
      ).rejects.toThrow(ForbiddenException);
      expectNothingRead();
    });
    it('transcribeAndAnalyzeVoice : 403, aucune transcription (quota préservé)', async () => {
      await expect(
        service.transcribeAndAnalyzeVoice(user, W, null, Buffer.from('x'), 'audio/webm'),
      ).rejects.toThrow(ForbiddenException);
      expectNothingRead();
    });
    it('executeActions : 403, aucun service métier appelé', async () => {
      await expect(
        service.executeActions(user, W, null, [{ type: 'CREATE_TASK', taskTitle: 'x' } as any]),
      ).rejects.toThrow(ForbiddenException);
      expect(projectsService.createTask).not.toHaveBeenCalled();
    });
  });

  it('projectId d’un autre workspace : 403', async () => {
    await expect(service.analyzeCommand(USERS.admin, W, 'PX', 'créer tâche x')).rejects.toThrow(
      ForbiddenException,
    );
    expectNothingRead();
  });

  it('projectId sans droit task.write (MEMBER sans rôle projet, CLIENT) : 403', async () => {
    await expect(service.analyzeCommand(USERS.member, W, 'P1', 'créer')).rejects.toThrow(
      ForbiddenException,
    );
    expectNothingRead();
  });

  it('la résolution des tâches est bornée aux projets où l’appelant peut écrire', async () => {
    prisma.task.findMany = jest.fn().mockResolvedValue([]);
    await service.analyzeCommand(USERS.contributor, W, null, 'créer tâche x');
    const where = (prisma.task.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.projectId).toEqual({ in: ['P1'] });
  });

  it('executeActions sans projet : la tâche est créée dans un projet accessible, jamais dans P2', async () => {
    prisma.project.findFirst = jest.fn();
    const result = await service.executeActions(USERS.contributor, W, null, [
      { type: 'CREATE_TASK', taskTitle: 'x' } as any,
    ]);
    expect(projectsService.createTask).toHaveBeenCalledWith(
      'P1',
      USERS.contributor,
      'x',
      undefined,
      'MEDIUM',
      {},
    );
    expect((result as any).changedTaskIds).toEqual(['T-new']);
  });

  describe('ExecuteAiActionsDto', () => {
    const check = (actions: unknown) =>
      validate(plainToInstance(ExecuteAiActionsDto, { workspaceId: W, actions }));
    it('refuse plus de 50 actions', async () => {
      const many = Array.from({ length: 51 }, () => ({ type: 'CREATE_TASK' }));
      expect((await check(many)).length).toBeGreaterThan(0);
    });
    it('refuse un type d’action inconnu et une action mal formée', async () => {
      expect((await check([{ type: 'DROP_TABLE' }])).length).toBeGreaterThan(0);
      expect((await check(['x'])).length).toBeGreaterThan(0);
    });
    it('accepte une action résolue valide', async () => {
      expect(
        await check([{ id: 'action-temp-0', type: 'CREATE_TASK', taskTitle: 'x', resolved: true }]),
      ).toEqual([]);
    });
  });
});
