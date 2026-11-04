/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PolicyService } from '../../../src/authz/policy.service';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { AssociateTasksDto } from '../../../src/projects/dto/associate-tasks.dto';
import { SprintService } from '../../../src/projects/sprint.service';
import { OTHER_W, USERS, W, buildRbacPrisma } from '../../support/rbac-fixture';

/** S13 : IDOR associateTasksToSprint, toutes les tâches sont vérifiées avant la moindre écriture. */
describe('S13 : associateTasksToSprint', () => {
  let service: SprintService;
  let prisma: ReturnType<typeof buildRbacPrisma> & Record<string, any>;
  const enqueue = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildRbacPrisma() as any;
    prisma.sprint = {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === 'S1'
          ? { id: 'S1', workspaceId: W }
          : where.id === 'SX'
            ? { id: 'SX', workspaceId: OTHER_W }
            : null,
      ),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const module = await Test.createTestingModule({
      providers: [
        SprintService,
        PolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirestoreSyncService, useValue: { enqueue } },
      ],
    }).compile();
    service = module.get(SprintService);
  });

  const expectNoWrite = () => {
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  };

  it('[tâche accessible, tâche d’un autre workspace] : 403 et aucune écriture', async () => {
    await expect(
      service.associateTasksToSprint('S1', ['T1', 'TX'], USERS.contributor),
    ).rejects.toThrow(ForbiddenException);
    expectNoWrite();
  });

  it('[tâche d’un autre workspace en seconde position, remise au backlog] : 403, aucune écriture', async () => {
    await expect(service.associateTasksToSprint(null, ['T1', 'TX'], USERS.admin)).rejects.toThrow(
      ForbiddenException,
    );
    expectNoWrite();
  });

  it('identifiant inexistant dans la liste : 403, aucune écriture', async () => {
    await expect(
      service.associateTasksToSprint(null, ['T1', 'inexistante'], USERS.admin),
    ).rejects.toThrow(ForbiddenException);
    expectNoWrite();
  });

  it('sprint d’un workspace avec une tâche d’un autre workspace : 403', async () => {
    await expect(service.associateTasksToSprint('SX', ['TX'], USERS.admin)).rejects.toThrow(
      ForbiddenException,
    );
    expectNoWrite();
  });

  it('un sprint du workspace A ne reçoit pas la tâche du workspace B, même pour son propriétaire', async () => {
    await expect(service.associateTasksToSprint('S1', ['TX'], USERS.outsider)).rejects.toThrow(
      ForbiddenException,
    );
    expectNoWrite();
  });

  it('tâche d’un projet sans droit task.write (CLIENT, COMMENTER) : 403', async () => {
    await expect(service.associateTasksToSprint('S1', ['T1'], USERS.client)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.associateTasksToSprint('S1', ['T1'], USERS.commenter)).rejects.toThrow(
      ForbiddenException,
    );
    expectNoWrite();
  });

  it('un VIEWER ne gère pas les sprints : 403', async () => {
    await expect(service.associateTasksToSprint(null, ['T1'], USERS.viewer)).rejects.toThrow(
      ForbiddenException,
    );
    expectNoWrite();
  });

  it('un CONTRIBUTOR de P1 ne touche pas à une tâche de P2 : 403', async () => {
    await expect(
      service.associateTasksToSprint('S1', ['T1', 'T2'], USERS.contributor),
    ).rejects.toThrow(ForbiddenException);
    expectNoWrite();
  });

  it('cas nominal : la mise à jour est bornée aux tâches vérifiées et les tâches modifiées sont renvoyées', async () => {
    const updated = await service.associateTasksToSprint('S1', ['T1', 'T1'], USERS.contributor);
    expect(prisma.task.updateMany).toHaveBeenCalledTimes(1);
    const args = prisma.task.updateMany.mock.calls[0][0];
    expect(args.where.id).toEqual({ in: ['T1'] });
    expect(args.data).toEqual({ sprintId: 'S1' });
    expect(updated).toEqual([{ id: 'T1', projectId: 'P1', workspaceId: W }]);
  });

  it('A2-b : sprint inexistant avec une tâche autorisée : 403 identique à une tâche interdite (pas d’oracle)', async () => {
    const missing = await service
      .associateTasksToSprint('absent', ['T1'], USERS.admin)
      .catch((e) => e);
    const forbidden = await service
      .associateTasksToSprint('S1', ['T1', 'TX'], USERS.admin)
      .catch((e) => e);
    expect(missing).toBeInstanceOf(ForbiddenException);
    expect(missing.getResponse()).toEqual(forbidden.getResponse());
    expectNoWrite();
  });

  it('liste vide : aucune écriture ni diffusion', async () => {
    await expect(service.associateTasksToSprint('S1', [], USERS.admin)).resolves.toEqual([]);
    expectNoWrite();
  });

  describe('AssociateTasksDto', () => {
    const check = async (taskIds: unknown) =>
      validate(plainToInstance(AssociateTasksDto, { taskIds }));

    it('refuse un identifiant qui n’est pas un UUID, un tableau trop grand ou un type invalide', async () => {
      expect((await check(['pas-un-uuid'])).length).toBeGreaterThan(0);
      expect((await check('texte')).length).toBeGreaterThan(0);
      expect((await check(undefined)).length).toBeGreaterThan(0);
      const many = Array.from({ length: 201 }, () => '2f1b3c4d-1111-4222-8333-444455556666');
      expect((await check(many)).length).toBeGreaterThan(0);
    });
    it('accepte des UUID v4', async () => {
      expect(await check(['2f1b3c4d-1111-4222-8333-444455556666'])).toEqual([]);
    });
  });
});
