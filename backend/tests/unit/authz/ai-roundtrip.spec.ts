/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppValidationPipe } from '../../../src/common/app-validation.pipe';
import { PolicyService } from '../../../src/authz/policy.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { AiService, normalizeResolvedAction } from '../../../src/projects/ai.service';
import {
  ExecuteAiActionsDto,
  RESOLVED_ACTION_MAX_LENGTH,
} from '../../../src/projects/dto/execute-ai-actions.dto';
import { ProjectsService } from '../../../src/projects/projects.service';
import { USERS, W, buildRbacPrisma } from '../../support/rbac-fixture';

/**
 * Décision 4 (partie technique) : la sortie d'`analyzeCommand` est acceptée telle quelle par le DTO
 * strict de `POST /projects/ai/execute` (même pipe que l'application), même quand le fournisseur
 * renvoie une décimale, un champ inconnu ou des valeurs `null`.
 */
describe('AiService : aller-retour analyzeCommand -> ExecuteAiActionsDto strict', () => {
  let service: AiService;
  const provider = {
    parseCommand: jest.fn(),
    isAvailable: jest.fn().mockReturnValue(true),
  };
  const pipe = new AppValidationPipe();
  const bodyOf = (actions: unknown) => ({ workspaceId: W, actions });
  const validate = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: ExecuteAiActionsDto });

  beforeEach(async () => {
    const prisma: any = buildRbacPrisma();
    const policyMembers = prisma.membership.findMany;
    prisma.membership.findMany = jest.fn(async (args: any) =>
      args?.include?.user
        ? [
            {
              userId: USERS.contributor,
              user: { id: USERS.contributor, name: 'Contributor', email: 'c@x.com' },
            },
          ]
        : policyMembers(args),
    );
    prisma.aiCommandHistory = { create: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AiService,
        PolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: {} },
        { provide: 'AI_PROVIDER', useValue: provider },
      ],
    }).compile();
    service = module.get(AiService);
  });

  const call = () => service.analyzeCommand(USERS.admin, W, null, 'commande');

  it('estimatedMinutes décimal, champ inconnu et null du fournisseur : accepté sans modification', async () => {
    provider.parseCommand.mockResolvedValue([
      {
        type: 'CREATE_TASK',
        taskTitle: 'Rédiger',
        priority: 'HIGH',
        estimatedMinutes: 45.5,
        dueDate: null,
        assigneeName: 'contributor',
        confidence: 0.93, // champ inconnu renvoyé par le fournisseur
      },
      { type: 'UPDATE_TASK_STATUS', taskTitle: 'Tâche 1', status: 'DONE', reasoning: 'x' },
    ]);
    const actions = await call();

    expect(actions[0].estimatedMinutes).toBe(46);
    expect(actions[0]).not.toHaveProperty('confidence');
    expect(actions[0]).not.toHaveProperty('dueDate');
    expect(actions[1]).not.toHaveProperty('reasoning');

    const body = JSON.parse(JSON.stringify(bodyOf(actions))); // aller-retour JSON réseau
    await expect(validate(body)).resolves.toBeDefined();
  });

  it('estimatedMinutes négatif ou démesuré : borné', async () => {
    provider.parseCommand.mockResolvedValue([
      { type: 'CREATE_TASK', taskTitle: 'a', estimatedMinutes: -3.2 },
      { type: 'CREATE_TASK', taskTitle: 'b', estimatedMinutes: 9_999_999.9 },
    ]);
    const actions = await call();
    expect(actions.map((a) => a.estimatedMinutes)).toEqual([0, 100000]);
    await expect(validate(JSON.parse(JSON.stringify(bodyOf(actions))))).resolves.toBeDefined();
  });

  it('O5 : valeurs hors énumération retirées, action acceptée par le DTO', async () => {
    provider.parseCommand.mockResolvedValue([
      {
        type: 'CREATE_TASK',
        taskTitle: 'Rédiger',
        priority: 'URGENT',
        status: 'BLOQUÉ',
        dependencyType: 'AFTER',
      },
      { type: 'CREATE_TASK', taskTitle: 'Valide', priority: 'LOW', status: 'DONE' },
    ]);
    const actions = await call();
    expect(actions[0]).not.toHaveProperty('priority');
    expect(actions[0]).not.toHaveProperty('status');
    expect(actions[0]).not.toHaveProperty('dependencyType');
    expect(actions[1]).toMatchObject({ priority: 'LOW', status: 'DONE' });
    await expect(validate(JSON.parse(JSON.stringify(bodyOf(actions))))).resolves.toBeDefined();
  });

  it("N5 : commande à titre démesuré : l'aperçu est tronqué, signalé (resolved: false) et accepté par le DTO", async () => {
    provider.parseCommand.mockResolvedValue([
      {
        type: 'CREATE_TASK',
        taskTitle: 'T'.repeat(4000),
        taskDescription: 'D'.repeat(20_000),
        assigneeName: 'A'.repeat(500),
        dueDate: '2026-01-01T00:00:00.' + '0'.repeat(300),
      },
    ]);
    const [action] = await call();

    expect(action.taskTitle).toHaveLength(RESOLVED_ACTION_MAX_LENGTH.taskTitle);
    expect(action.taskDescription).toHaveLength(RESOLVED_ACTION_MAX_LENGTH.taskDescription);
    expect(action).not.toHaveProperty('dueDate'); // une date tronquée serait fausse
    expect(action.resolved).toBe(false);
    expect(action.warning).toContain('taskTitle');
    expect(action.warning).toContain('dueDate');
    expect(action.description!.length).toBeLessThanOrEqual(RESOLVED_ACTION_MAX_LENGTH.description);
    await expect(validate(JSON.parse(JSON.stringify(bodyOf([action]))))).resolves.toBeDefined();
  });

  it('N5 : toute sortie de normalizeResolvedAction valide ExecuteAiActionsDto, quel que soit le champ démesuré', async () => {
    for (const field of Object.keys(RESOLVED_ACTION_MAX_LENGTH)) {
      const raw = { type: 'CREATE_TASK', resolved: true, [field]: 'x'.repeat(100_000) };
      const out = normalizeResolvedAction(raw as never);
      await expect(validate(JSON.parse(JSON.stringify(bodyOf([out]))))).resolves.toBeDefined();
    }
  });

  it("N5 : une coupure ne laisse pas la moitié d'une paire de substitution (émoji)", () => {
    const out = normalizeResolvedAction({
      type: 'CREATE_TASK',
      taskTitle: 'a'.repeat(190) + '😀😀',
    } as never);
    expect(out.taskTitle).toBe('a'.repeat(190));
    expect(JSON.parse(JSON.stringify(out)).taskTitle).toBe('a'.repeat(190));
  });

  it("N5 : une action aux champs dans les bornes n'est pas modifiée", () => {
    const ok = {
      type: 'CREATE_TASK',
      resolved: true,
      taskTitle: 'T'.repeat(191),
      dueDate: '2026-01-01',
    };
    expect(normalizeResolvedAction(ok as never)).toEqual(ok);
  });

  it('le DTO reste strict : un champ inconnu envoyé par le client est refusé', async () => {
    await expect(
      validate(bodyOf([{ type: 'CREATE_TASK', taskTitle: 'x', confidence: 1 }])),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate(bodyOf([{ type: 'CREATE_TASK', estimatedMinutes: 45.5 }])),
    ).rejects.toThrow(BadRequestException);
  });
});
