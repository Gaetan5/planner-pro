/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { TrackingGateway } from './tracking.gateway';
import { TrackingService } from './tracking.service';
import { JwtService } from '@nestjs/jwt';
import { AiService } from '../projects/ai.service';
import { ProjectPermissionsService } from '../projects/project-permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { SessionService } from '../auth/session.service';
import { STUB_SID, sessionServiceStub } from '../../tests/support/session.test-support';
import { Socket } from 'socket.io';
import { RealtimeService } from '../realtime/realtime.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('TrackingGateway', () => {
  let gateway: TrackingGateway;
  let aiService: AiService;

  const mockTrackingService = {
    getActiveTracking: jest.fn(),
    startTracking: jest.fn(),
    stopActiveTracking: jest.fn(),
  };

  const JWT_SECRET = 'test-secret-tracking-gateway-0123456789';
  const realJwtService = new JwtService({ secret: JWT_SECRET });
  let tokenService: TokenService;

  const mockAiService = {
    transcribeAndAnalyzeVoice: jest.fn(),
  };

  const mockProjectPermissionsService = {
    assertProjectRole: jest.fn(),
  };

  const mockPrismaService = {
    task: {
      findUnique: jest.fn(),
    },
  };

  const mockRealtime = {
    attach: jest.fn(),
    roomsForUser: jest.fn(),
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingGateway,
        { provide: TrackingService, useValue: mockTrackingService },
        { provide: JwtService, useValue: realJwtService },
        TokenService,
        {
          provide: SessionService,
          useFactory: (tokens: TokenService) => sessionServiceStub(tokens),
          inject: [TokenService],
        },
        { provide: AiService, useValue: mockAiService },
        { provide: ProjectPermissionsService, useValue: mockProjectPermissionsService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RealtimeService, useValue: mockRealtime },
      ],
    }).compile();

    gateway = module.get<TrackingGateway>(TrackingGateway);
    aiService = module.get<AiService>(AiService);
    tokenService = module.get<TokenService>(TokenService);
  });

  describe('Voice Streaming WebSockets', () => {
    let mockClient: any;

    beforeEach(() => {
      jest.clearAllMocks();
      mockClient = {
        id: 'socket-id-123',
        data: {
          userId: 'user-id-123',
          audioChunks: [],
        },
        emit: jest.fn(),
      };
    });

    it('devrait initialiser les chunks audio lors de voice-start', () => {
      const res = gateway.handleVoiceStart(mockClient as Socket);
      expect(res.status).toBe('success');
      expect(mockClient.data.audioChunks).toEqual([]);
    });

    it('devrait accumuler les chunks audio lors de voice-chunk', () => {
      gateway.handleVoiceStart(mockClient as Socket);

      const chunk1 = Buffer.from('chunk1');
      const chunk2 = Buffer.from('chunk2');

      gateway.handleVoiceChunk(chunk1, mockClient as Socket);
      gateway.handleVoiceChunk(chunk2, mockClient as Socket);

      expect(mockClient.data.audioChunks).toHaveLength(2);
      expect(mockClient.data.audioChunks[0]).toEqual(chunk1);
      expect(mockClient.data.audioChunks[1]).toEqual(chunk2);
    });

    it('devrait assembler les chunks, transcrire et émettre voice-result lors de voice-end', async () => {
      gateway.handleVoiceStart(mockClient as Socket);

      const chunk1 = Buffer.from('Hello ');
      const chunk2 = Buffer.from('World');

      gateway.handleVoiceChunk(chunk1, mockClient as Socket);
      gateway.handleVoiceChunk(chunk2, mockClient as Socket);

      const expectedAudioBuffer = Buffer.concat([chunk1, chunk2]);

      const mockResult = {
        transcription: 'Hello World',
        actions: [{ type: 'CREATE_TASK', taskTitle: 'Test task' }],
      };

      mockAiService.transcribeAndAnalyzeVoice.mockResolvedValue(mockResult);

      const res = await gateway.handleVoiceEnd(
        { workspaceId: 'ws-123', projectId: null, mimeType: 'audio/webm', isMock: true },
        mockClient as Socket,
      );

      expect(res.status).toBe('success');
      expect(aiService.transcribeAndAnalyzeVoice).toHaveBeenCalledWith(
        'user-id-123',
        'ws-123',
        null,
        expectedAudioBuffer,
        'audio/webm',
        true,
      );
      expect(mockClient.emit).toHaveBeenCalledWith('voice-result', mockResult);
      expect(mockClient.data.audioChunks).toEqual([]); // Nettoyé après envoi
    });

    it("devrait retourner une erreur si aucun chunk n'a été reçu", async () => {
      mockClient.data.audioChunks = [];

      const res = await gateway.handleVoiceEnd(
        { workspaceId: 'ws-123', projectId: null },
        mockClient as Socket,
      );

      expect(res.status).toBe('error');
      expect(res.message).toContain('Aucun morceau audio reçu');
      expect(mockAiService.transcribeAndAnalyzeVoice).not.toHaveBeenCalled();
    });

    describe('join-task authorization failures', () => {
      const mockClient = {
        id: 'socket-id-123',
        data: { userId: 'user-id-123' },
        join: jest.fn(),
      };

      beforeEach(() => {
        jest.clearAllMocks();
      });

      it('retourne une erreur spécifique lorsque le projet est introuvable', async () => {
        mockPrismaService.task.findUnique.mockResolvedValue({ projectId: 'project-1' });
        mockProjectPermissionsService.assertProjectRole.mockRejectedValue(
          new NotFoundException('Projet introuvable'),
        );

        await expect(
          gateway.handleJoinTask({ taskId: 'task-1' }, mockClient as unknown as Socket),
        ).resolves.toEqual({ status: 'error', message: 'Projet introuvable.' });
      });

      it('distingue un refus d’accès d’une erreur interne', async () => {
        mockPrismaService.task.findUnique.mockResolvedValue({ projectId: 'project-1' });
        mockProjectPermissionsService.assertProjectRole.mockRejectedValue(
          new ForbiddenException('Forbidden'),
        );

        await expect(
          gateway.handleJoinTask({ taskId: 'task-1' }, mockClient as unknown as Socket),
        ).resolves.toEqual({ status: 'error', message: 'Accès au projet non autorisé.' });

        mockProjectPermissionsService.assertProjectRole.mockRejectedValue(
          new Error('Database unavailable'),
        );
        await expect(
          gateway.handleJoinTask({ taskId: 'task-1' }, mockClient as unknown as Socket),
        ).resolves.toEqual({
          status: 'error',
          message: "Impossible de vérifier l'accès à cette tâche. Réessayez ultérieurement.",
        });
      });
    });
  });

  // S3 : la gateway de tracking applique la même vérification que le guard HTTP
  describe('authentification du handshake', () => {
    it.each([
      ['ticket MFA', () => tokenService.signMfaTicket('user-1').ticket],
      ['jeton sans typ', () => realJwtService.sign({ sub: 'user-1' })],
    ])('déconnecte un handshake présentant un %s', async (_label, makeToken) => {
      const client = {
        id: 'socket-s3',
        handshake: { auth: { token: makeToken() }, headers: {} },
        data: {} as Record<string, unknown>,
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(client as unknown as Socket);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
      expect(mockTrackingService.getActiveTracking).not.toHaveBeenCalled();
    });
  });

  // S7 : cookie httpOnly au handshake, coupure d'une socket dont la session est révoquée
  describe('session WebSocket (S7)', () => {
    const makeClient = (headers: Record<string, string>, auth: Record<string, unknown> = {}) => ({
      id: 'socket-s7',
      handshake: { auth, headers },
      data: {} as Record<string, unknown>,
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    });

    beforeEach(() => {
      jest.clearAllMocks();
      mockRealtime.roomsForUser.mockResolvedValue({ projects: [], workspaces: [] });
      mockTrackingService.getActiveTracking.mockResolvedValue(null);
    });
    afterEach(() => jest.useRealTimers());

    it('authentifie le handshake par le cookie accessToken (navigateur, withCredentials)', async () => {
      const token = tokenService.signAccessToken({ sub: 'user-1', sid: STUB_SID });
      const client = makeClient({
        cookie: `theme=dark; accessToken=${token}`,
        origin: 'http://localhost:3000',
      });
      await gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      gateway.handleDisconnect(client as unknown as Socket);
    });

    it('déconnecte la socket dans la minute qui suit la révocation de la session', async () => {
      jest.useFakeTimers();
      const sessions = (gateway as unknown as { sessionService: { isSessionActive: jest.Mock } })
        .sessionService;
      const token = tokenService.signAccessToken({ sub: 'user-1', sid: STUB_SID });
      const client = makeClient({
        cookie: `accessToken=${token}`,
        origin: 'http://localhost:3000',
      });
      await gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).not.toHaveBeenCalled();

      sessions.isSessionActive.mockResolvedValue(false); // logout ou révocation admin
      await jest.advanceTimersByTimeAsync(60_000);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      gateway.handleDisconnect(client as unknown as Socket);
    });

    it('refuse un handshake sans aucun jeton', async () => {
      const client = makeClient({});
      await gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('journalise la cause et déconnecte si le calcul des salons échoue', async () => {
      const token = tokenService.signAccessToken({ sub: 'user-1', sid: STUB_SID });
      mockRealtime.roomsForUser.mockRejectedValue(new Error('Database unavailable'));
      const client = makeClient({}, { token });
      await gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  // S16 : salons, indicateur de saisie et flux audio bornés
  describe('S16 : temps réel', () => {
    const makeClient = (rooms: string[] = []) => {
      const emit = jest.fn();
      return {
        id: 'socket-s16',
        data: { userId: 'user-1' } as Record<string, unknown>,
        rooms: new Set(rooms),
        to: jest.fn(() => ({ emit })),
        emit: jest.fn(),
        join: jest.fn(),
        _emitTo: emit,
      };
    };

    beforeEach(() => jest.clearAllMocks());

    it('typing sans join-task préalable : aucune émission (usurpation impossible)', async () => {
      const client = makeClient();
      await gateway.handleTyping(
        { taskId: 'T-victime', isTyping: true },
        client as unknown as Socket,
      );
      expect(client.to).not.toHaveBeenCalled();
    });

    it('typing après join-task : émis vers la room de la tâche', async () => {
      const client = makeClient(['task:T1']);
      await gateway.handleTyping({ taskId: 'T1', isTyping: true }, client as unknown as Socket);
      expect(client.to).toHaveBeenCalledWith('task:T1');
      expect(client._emitTo).toHaveBeenCalledWith(
        'user-typing',
        expect.objectContaining({ taskId: 'T1', userId: 'user-1' }),
      );
    });

    it('voice-chunk de plus de 64 Ko : erreur et tampon vidé', () => {
      const client = makeClient();
      gateway.handleVoiceStart(client as unknown as Socket);
      gateway.handleVoiceChunk(Buffer.alloc(100), client as unknown as Socket);
      const res = gateway.handleVoiceChunk(
        Buffer.alloc(64 * 1024 + 1),
        client as unknown as Socket,
      );
      expect(res.status).toBe('error');
      expect(client.data.audioChunks).toEqual([]);
    });

    it('voice-chunk au-delà de 10 Mo cumulés : erreur et tampon vidé', () => {
      const client = makeClient();
      gateway.handleVoiceStart(client as unknown as Socket);
      let last: { status: string } = { status: 'success' };
      for (let i = 0; i < 200 && last.status === 'success'; i++) {
        last = gateway.handleVoiceChunk(Buffer.alloc(64 * 1024), client as unknown as Socket);
      }
      expect(last.status).toBe('error');
      expect(client.data.audioChunks).toEqual([]);
      expect(client.data.audioBytes).toBe(0);
    });

    it('voice-chunk : un message qui n’est pas binaire est refusé', () => {
      const client = makeClient();
      const res = gateway.handleVoiceChunk('texte' as never, client as unknown as Socket);
      expect(res.status).toBe('error');
    });

    it('débit : au-delà de 300 messages en 10 s, la socket est limitée', () => {
      const client = makeClient();
      let last: { status: string } = { status: 'success' };
      for (let i = 0; i < 301; i++) {
        last = gateway.handleVoiceChunk(Buffer.alloc(1), client as unknown as Socket);
      }
      expect(last.status).toBe('error');
    });

    it('voice-end avec un workspace étranger : { status: error } et aucune donnée', async () => {
      const client = makeClient();
      client.data.audioChunks = [Buffer.from('x')];
      mockAiService.transcribeAndAnalyzeVoice.mockRejectedValue(
        new ForbiddenException('Workspace not found or unauthorized'),
      );
      const res = await gateway.handleVoiceEnd(
        { workspaceId: 'ws-etranger', projectId: null },
        client as unknown as Socket,
      );
      expect(res.status).toBe('error');
      expect(client.emit).not.toHaveBeenCalledWith('voice-result', expect.anything());
    });

    it('connexion : les salons viennent de la politique (projets accessibles), pas de tous les workspaces', async () => {
      const token = tokenService.signAccessToken({ sub: 'user-1', sid: STUB_SID });
      mockRealtime.roomsForUser.mockResolvedValue({
        projects: ['project:P1'],
        workspaces: ['workspace:ws-1'],
      });
      mockTrackingService.getActiveTracking.mockResolvedValue(null);
      const client = {
        id: 'socket-conn',
        handshake: { auth: { token }, headers: {} },
        data: {} as Record<string, unknown>,
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      };
      await gateway.handleConnection(client as unknown as Socket);
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.join).toHaveBeenCalledWith('project:P1');
      expect(client.join).toHaveBeenCalledWith('workspace:ws-1');
      expect(client.join).not.toHaveBeenCalledWith('project:P2');
      gateway.handleDisconnect(client as unknown as Socket);
    });
  });
});
