/* eslint-disable @typescript-eslint/no-explicit-any */
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import { PolicyService } from '../../../src/authz/policy.service';
import { JwtAuthGuard } from '../../../src/auth/jwt.guard';
import { SessionService } from '../../../src/auth/session.service';
import { TokenService } from '../../../src/auth/token.service';
import { AppValidationPipe } from '../../../src/common/app-validation.pipe';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';
import { NotificationsService } from '../../../src/notifications/notifications.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { AiService } from '../../../src/projects/ai.service';
import { CommentsController } from '../../../src/projects/comments.controller';
import { CommentsService } from '../../../src/projects/comments.service';
import { IntegrationService } from '../../../src/projects/integration.service';
import { ProjectsService } from '../../../src/projects/projects.service';
import { NotesService } from '../../../src/notes/notes.service';
import { TasksService } from '../../../src/projects/tasks.service';
import { DependenciesService } from '../../../src/projects/dependencies.service';
import { TimeBlocksService } from '../../../src/projects/timeblocks.service';
import { MilestonesService } from '../../../src/projects/milestones.service';
import { ResourcesService } from '../../../src/projects/resources.service';
import { FinancesService } from '../../../src/projects/finances.service';
import { ProjectPermissionsService } from '../../../src/projects/project-permissions.service';
import { RealtimeService } from '../../../src/realtime/realtime.service';
import { TrackingGateway } from '../../../src/tracking/tracking.gateway';
import { TrackingService } from '../../../src/tracking/tracking.service';
import { USERS, W, buildRbacPrisma, id } from '../../support/rbac-fixture';
import { STUB_SID, sessionServiceStub } from '../../support/session.test-support';

// La gateway réelle tente de se brancher à Redis : on simule un Redis injoignable (échec capté
// par la gateway, qui reste alors sur l'adaptateur mémoire) pour ne laisser aucun handle ouvert.
jest.mock('redis', () => {
  const client: any = {
    connect: () => Promise.reject(new Error('redis simulé indisponible')),
    duplicate: () => client,
  };
  return { createClient: () => client };
});

jest.setTimeout(60_000);

/**
 * S16-a : révocation des salons `task:<id>` sur un VRAI serveur Socket.IO (gateway réelle,
 * adaptateur Nest, clients socket.io-client), avec un vrai POST de commentaire.
 */
describe('S16-a : un accès retiré coupe aussi le salon task:<id> (Socket.IO réel)', () => {
  const JWT_SECRET = 'test-secret-task-room-revocation-0123456789';
  let app: INestApplication;
  let baseUrl: string;
  let prisma: any;
  let permissions: ProjectPermissionsService;
  let realtime: RealtimeService;
  let tokens: TokenService;
  const clients: Socket[] = [];
  const savedEnv = { ...process.env };
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  const tokenOf = (userId: string) =>
    tokens.signAccessToken({ sub: userId, email: `${userId}@x.com`, sid: STUB_SID });

  /** Client connecté, avec ses événements `new-comment` collectés. */
  async function connect(userId: string) {
    const socket = io(baseUrl, {
      auth: { token: tokenOf(userId) },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    clients.push(socket);
    const received: any[] = [];
    socket.on('new-comment', (payload) => received.push(payload));
    await new Promise<void>((resolve, reject) => {
      socket.once('active-timer-state', () => resolve());
      socket.once('connect_error', reject);
      socket.once('disconnect', () => reject(new Error('déconnecté avant la fin du handshake')));
    });
    return { socket, received };
  }

  const roomsOf = async (userId: string) =>
    (await app.get(TrackingGateway).server.in(`user:${userId}`).fetchSockets()).flatMap((s) => [
      ...s.rooms,
    ]);

  const postComment = (taskId: string, userId: string, content: string) =>
    fetch(`${baseUrl}/projects/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenOf(userId)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    prisma = buildRbacPrisma();
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    prisma.auditLog = { create: jest.fn() };
    prisma.comment = {
      findFirst: jest.fn(),
      create: jest.fn(async ({ data }: any) => ({
        id: 'C-new',
        ...data,
        attachments: [],
        user: { id: data.userId, name: 'Auteur', email: 'a@x.com' },
      })),
    };
    prisma.project.create = jest.fn(async ({ data }: any) => {
      const row = {
        id: 'P-new',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      prisma.data.projects.push(row);
      return row;
    });
    prisma.projectMembership.create = jest.fn(async ({ data }: any) => {
      const row = { id: 'pm-new', ...data };
      prisma.data.projectMemberships.push(row);
      return row;
    });
    prisma.projectMembership.delete = jest.fn(async ({ where }: any) => {
      const i = prisma.data.projectMemberships.findIndex((p: any) => p.id === where.id);
      return prisma.data.projectMemberships.splice(i, 1)[0];
    });
    const jwtService = new JwtService({ secret: JWT_SECRET });
    const moduleRef = await Test.createTestingModule({
      controllers: [CommentsController],
      providers: [
        TrackingGateway,
        CommentsService,
        PolicyService,
        RealtimeService,
        ProjectPermissionsService,
        ProjectsService,
        JwtAuthGuard,
        ...[
          NotesService,
          TasksService,
          DependenciesService,
          TimeBlocksService,
          MilestonesService,
          ResourcesService,
          FinancesService,
        ].map((provide) => ({ provide, useValue: {} })),
        TokenService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: JwtService, useValue: jwtService },
        {
          provide: SessionService,
          useFactory: (t: TokenService) => sessionServiceStub(t),
          inject: [TokenService],
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: TrackingService,
          useValue: { getActiveTracking: jest.fn().mockResolvedValue(null) },
        },
        { provide: AiService, useValue: {} },
        { provide: IntegrationService, useValue: { sendNotification: jest.fn() } },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: FirestoreSyncService, useValue: { enqueue: jest.fn() } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useWebSocketAdapter(new IoAdapter(app));
    app.useGlobalPipes(new AppValidationPipe());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    permissions = app.get(ProjectPermissionsService);
    realtime = app.get(RealtimeService);
    tokens = app.get(TokenService);
  });

  afterEach(async () => {
    for (const socket of clients.splice(0)) socket.close();
    await app.close();
    process.env = { ...savedEnv };
  });

  afterAll(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  async function joinTask(client: Socket, taskId: string) {
    const ack = await client.timeout(5000).emitWithAck('join-task', { taskId });
    expect(ack).toEqual({ status: 'success' });
  }

  it('retrait du rôle de projet : le client ne reçoit plus new-comment, un client autorisé le reçoit', async () => {
    const revoked = await connect(USERS.client); // CLIENT de P1
    const stays = await connect(USERS.contributor); // CONTRIBUTOR de P1
    await joinTask(revoked.socket, id('T1'));
    await joinTask(stays.socket, id('T1'));
    expect(await roomsOf(USERS.client)).toEqual(
      expect.arrayContaining([`task:${id('T1')}`, `project:${id('P1')}`]),
    );

    // Contrôle positif avant révocation : les deux reçoivent le commentaire
    expect((await postComment(id('T1'), USERS.owner, 'avant')).status).toBe(201);
    await pause(200);
    expect(revoked.received.map((r) => r.comment.content)).toEqual(['avant']);
    expect(stays.received.map((r) => r.comment.content)).toEqual(['avant']);

    await permissions.removeProjectRole(id('P1'), USERS.client, USERS.owner);

    const rooms = await roomsOf(USERS.client);
    expect(rooms).not.toContain(`project:${id('P1')}`);
    expect(rooms).not.toContain(`task:${id('T1')}`);

    expect((await postComment(id('T1'), USERS.owner, 'secret après révocation')).status).toBe(201);
    await pause(300);
    expect(stays.received.map((r) => r.comment.content)).toEqual([
      'avant',
      'secret après révocation',
    ]);
    expect(revoked.received.map((r) => r.comment.content)).toEqual(['avant']);
  });

  it('désactivation SCIM (Membership supprimée) : plus de project:<id> ni de task:<id>, plus de new-comment', async () => {
    const deprovisioned = await connect(USERS.commenter); // MEMBER + COMMENTER de P1
    await joinTask(deprovisioned.socket, id('T1'));
    expect(await roomsOf(USERS.commenter)).toEqual(
      expect.arrayContaining([`task:${id('T1')}`, `project:${id('P1')}`]),
    );

    // Ce que fait la désactivation SCIM : la Membership disparaît, puis les salons sont recalculés
    prisma.data.memberships.splice(
      prisma.data.memberships.findIndex((m: any) => m.userId === USERS.commenter),
      1,
    );
    await realtime.refreshUserRooms(USERS.commenter);

    const rooms = await roomsOf(USERS.commenter);
    expect(rooms.filter((r) => r.startsWith('project:') || r.startsWith('task:'))).toEqual([]);

    expect((await postComment(id('T1'), USERS.owner, 'après désactivation')).status).toBe(201);
    await pause(300);
    expect(deprovisioned.received).toEqual([]);
  });

  it('S16-b : le créateur et un ADMIN déjà connectés reçoivent les événements du nouveau projet', async () => {
    const creator = await connect(USERS.contributor); // MEMBER : peut créer un projet
    const admin = await connect(USERS.admin);
    const outsider = await connect(USERS.client); // CLIENT de P1 seulement
    for (const c of [creator, admin, outsider]) {
      c.socket.on('task-status-changed', (payload) => c.received.push(payload));
    }

    const project = await app
      .get(ProjectsService)
      .createProject(USERS.contributor, 'Nouveau projet', undefined, W);
    realtime.emitToProject(project.id, 'task-status-changed', { taskId: 'T-new' });
    await pause(300);

    expect(creator.received.filter((r) => r.taskId === 'T-new')).toHaveLength(1);
    expect(admin.received.filter((r) => r.taskId === 'T-new')).toHaveLength(1);
    expect(outsider.received.filter((r) => r.taskId === 'T-new')).toHaveLength(0);
  });

  it('un salon de tâche reste conservé tant que le projet est accessible', async () => {
    const stays = await connect(USERS.commenter);
    await joinTask(stays.socket, id('T1'));
    await realtime.refreshUserRooms(USERS.commenter);
    expect(await roomsOf(USERS.commenter)).toEqual(expect.arrayContaining([`task:${id('T1')}`]));
  });
});
