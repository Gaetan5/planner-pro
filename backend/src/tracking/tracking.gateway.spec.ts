import { Test, TestingModule } from '@nestjs/testing';
import { TrackingGateway } from './tracking.gateway';
import { TrackingService } from './tracking.service';
import { JwtService } from '@nestjs/jwt';
import { AiService } from '../projects/ai.service';
import { Socket } from 'socket.io';

describe('TrackingGateway', () => {
  let gateway: TrackingGateway;
  let aiService: AiService;

  const mockTrackingService = {
    getActiveTracking: jest.fn(),
    startTracking: jest.fn(),
    stopActiveTracking: jest.fn(),
  };

  const mockJwtService = {
    verifyAsync: jest.fn(),
  };

  const mockAiService = {
    transcribeAndAnalyzeVoice: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingGateway,
        { provide: TrackingService, useValue: mockTrackingService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    gateway = module.get<TrackingGateway>(TrackingGateway);
    aiService = module.get<AiService>(AiService);
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

    it('devrait retourner une erreur si aucun chunk n\'a été reçu', async () => {
      mockClient.data.audioChunks = [];

      const res = await gateway.handleVoiceEnd(
        { workspaceId: 'ws-123', projectId: null },
        mockClient as Socket,
      );

      expect(res.status).toBe('error');
      expect(res.message).toContain('Aucun morceau audio reçu');
      expect(mockAiService.transcribeAndAnalyzeVoice).not.toHaveBeenCalled();
    });
  });
});
