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
});
