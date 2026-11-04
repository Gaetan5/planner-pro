/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { PolicyService } from '../../../src/authz/policy.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ProjectPermissionsService } from '../../../src/projects/project-permissions.service';
import { RealtimeService } from '../../../src/realtime/realtime.service';
import { USERS, W, buildRbacPrisma } from '../../support/rbac-fixture';

/** S16 / A4 : salons de projet selon les droits, et révocation immédiate au changement de rôle. */
describe('S16 : RealtimeService', () => {
  let prisma: ReturnType<typeof buildRbacPrisma> & Record<string, any>;
  let realtime: RealtimeService;
  let permissions: ProjectPermissionsService;
  let remoteSockets: any[];
  const emitted: { room: string; event: string }[] = [];
  const server = {
    to: (room: string) => ({ emit: (event: string) => emitted.push({ room, event }) }),
    in: () => ({
      fetchSockets: async () => remoteSockets,
      disconnectSockets: jest.fn(),
    }),
  };

  const makeSocket = (rooms: string[]) => {
    const set = new Set(rooms);
    return {
      rooms: set,
      join: jest.fn((room: string) => set.add(room)),
      leave: jest.fn((room: string) => set.delete(room)),
    };
  };

  beforeEach(async () => {
    emitted.length = 0;
    prisma = buildRbacPrisma() as any;
    prisma.auditLog = { create: jest.fn() };
    (prisma.projectMembership as any).delete = jest.fn(async ({ where }: any) => {
      const i = prisma.data.projectMemberships.findIndex((p: any) => p.id === where.id);
      return prisma.data.projectMemberships.splice(i, 1)[0];
    });
    (prisma.projectMembership as any).upsert = jest.fn(async ({ create }: any) => {
      const row = { id: 'pm-new', ...create };
      prisma.data.projectMemberships.push(row);
      return row;
    });
    const module = await Test.createTestingModule({
      providers: [
        RealtimeService,
        PolicyService,
        ProjectPermissionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    realtime = module.get(RealtimeService);
    permissions = module.get(ProjectPermissionsService);
    realtime.attach(server as any);
  });

  it('un CLIENT de P1 rejoint project:P1 et pas project:P2', async () => {
    const rooms = await realtime.roomsForUser(USERS.client);
    expect(rooms.projects).toEqual(['project:P1']);
    expect(rooms.workspaces).toEqual([`workspace:${W}`]);
  });

  it('un MEMBER sans rôle projet ne rejoint aucun salon de projet', async () => {
    expect((await realtime.roomsForUser(USERS.member)).projects).toEqual([]);
  });

  it('les tâches sont diffusées vers project:<id> uniquement', () => {
    realtime.emitToProject('P2', 'task-status-changed', { taskId: 'T2' });
    expect(emitted).toEqual([{ room: 'project:P2', event: 'task-status-changed' }]);
  });

  it('removeProjectRole : la socket du retiré quitte project:P1 immédiatement', async () => {
    const socket = makeSocket(['user:' + USERS.client, 'project:P1', `workspace:${W}`]);
    remoteSockets = [socket];

    await permissions.removeProjectRole('P1', USERS.client, USERS.owner);

    expect(socket.leave).toHaveBeenCalledWith('project:P1');
    expect(socket.rooms.has('project:P1')).toBe(false);
    expect(socket.rooms.has(`workspace:${W}`)).toBe(true);
  });

  it('removeProjectRole : la socket quitte aussi task:<id> de la tâche du projet (S16-a)', async () => {
    // T1 appartient à P1 (rôle retiré) ; T2 à P2, où le client n'a jamais eu de rôle
    const socket = makeSocket(['user:' + USERS.client, 'project:P1', 'task:T1', 'task:T2']);
    remoteSockets = [socket];

    await permissions.removeProjectRole('P1', USERS.client, USERS.owner);

    expect(socket.rooms.has('project:P1')).toBe(false);
    expect(socket.rooms.has('task:T1')).toBe(false);
    expect(socket.rooms.has('task:T2')).toBe(false);
  });

  it('refreshUserRooms conserve task:<id> d’un projet encore accessible, une seule requête', async () => {
    const socket = makeSocket(['user:' + USERS.client, 'project:P1', 'task:T1']);
    remoteSockets = [socket];
    (prisma.task.findMany as jest.Mock).mockClear();

    await realtime.refreshUserRooms(USERS.client);

    expect(socket.rooms.has('task:T1')).toBe(true);
    expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
  });

  it('assignProjectRole : la socket rejoint le nouveau salon sans reconnexion', async () => {
    const socket = makeSocket(['user:' + USERS.member, `workspace:${W}`]);
    remoteSockets = [socket];

    await permissions.assignProjectRole('P2', USERS.member, 'CONTRIBUTOR', USERS.owner);

    expect(socket.join).toHaveBeenCalledWith('project:P2');
  });

  it('échec du recalcul : les sockets de l’utilisateur sont coupées (échec fermé)', async () => {
    const disconnect = jest.fn();
    realtime.attach({
      in: () => ({
        fetchSockets: async () => {
          throw new Error('redis indisponible');
        },
        disconnectSockets: disconnect,
      }),
    } as any);
    await realtime.refreshUserRooms(USERS.client);
    expect(disconnect).toHaveBeenCalledWith(true);
  });
  describe('S16-c : evictTaskRoom', () => {
    it('fait quitter le salon task:<id> à tous ses abonnés', () => {
      const socketsLeave = jest.fn();
      const inRoom = jest.fn(() => ({ socketsLeave }));
      realtime.attach({ in: inRoom } as any);
      realtime.evictTaskRoom('T1');
      expect(inRoom).toHaveBeenCalledWith('task:T1');
      expect(socketsLeave).toHaveBeenCalledWith('task:T1');
    });

    it('sans serveur attaché : aucune exception', () => {
      const detached = new RealtimeService({} as any);
      expect(() => detached.evictTaskRoom('T1')).not.toThrow();
    });
  });
});
