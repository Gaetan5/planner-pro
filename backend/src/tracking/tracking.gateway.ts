import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TrackingService } from './tracking.service';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { AiService } from '../projects/ai.service';
import { ProjectPermissionsService } from '../projects/project-permissions.service';
import { PrismaService } from '../prisma/prisma.service';

@SkipThrottle()
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    credentials: true,
  },
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly trackingService: TrackingService,
    private readonly jwtService: JwtService,
    private readonly aiService: AiService,
    private readonly projectPermissionsService: ProjectPermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  async afterInit(server: Server) {
    const pubClient = createClient({ url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}` });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    server.adapter(createAdapter(pubClient, subClient));
    console.log('Socket.io Redis adapter configuré avec succès.');
  }

  async handleConnection(client: Socket) {
    console.log(`Client connecté : ${client.id}`);
    
    let token = client.handshake.auth?.token || client.handshake.headers?.authorization;
    if (token && token.startsWith('Bearer ')) {
      token = token.slice(7);
    }

    if (!token) {
      console.log('Accès WebSocket refusé : Identifiant non fourni.');
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      client.data.userId = payload.sub;
      client.join(`user:${client.data.userId}`);
      console.log(`Client authentifié : ${client.data.userId} (Socket: ${client.id})`);
      
      const activeTracking = await this.trackingService.getActiveTracking(client.data.userId);
      client.emit('active-timer-state', activeTracking);
    } catch (error: unknown) {
      console.log('Accès WebSocket refusé : Validation de l\'identité échouée.');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Client déconnecté : ${client.id}`);
  }

  @SubscribeMessage('start-timer')
  async handleStartTimer(
    @MessageBody() data: { taskId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    if (!userId) {
      return { status: 'error', message: 'Non authentifié.' };
    }
    try {
      const log = await this.trackingService.startTracking(userId, data.taskId);
      // Diffuser le nouvel état à TOUS les clients connectés du même utilisateur
      this.server.to(`user:${userId}`).emit('timer-started', log);
      return { status: 'success', data: log };
    } catch (error: unknown) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  @SubscribeMessage('stop-timer')
  async handleStopTimer(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    if (!userId) {
      return { status: 'error', message: 'Non authentifié.' };
    }
    try {
      const log = await this.trackingService.stopActiveTracking(userId);
      // Diffuser l'arrêt à TOUS les clients connectés du même utilisateur
      this.server.to(`user:${userId}`).emit('timer-stopped', log);
      return { status: 'success', data: log };
    } catch (error: unknown) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  @SubscribeMessage('request-active-timer')
  async handleRequestActiveTimer(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    if (!userId) return;
    const activeTracking = await this.trackingService.getActiveTracking(userId);
    client.emit('active-timer-state', activeTracking);
  }

  @SubscribeMessage('join-task')
  async handleJoinTask(
    @MessageBody() data: { taskId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    if (!userId) return { status: 'error', message: 'Non authentifié.' };

    const task = await this.prisma.task.findUnique({
      where: { id: data.taskId },
      select: { projectId: true },
    });

    if (!task) return { status: 'error', message: 'Tâche introuvable.' };

    try {
      // Vérifier la permission d'accès au projet
      await this.projectPermissionsService.assertProjectRole(task.projectId, userId, ['MANAGER', 'CONTRIBUTOR', 'COMMENTER', 'CLIENT']);
      
      client.join(`task:${data.taskId}`);
      console.log(`Socket ${client.id} a rejoint la room task:${data.taskId}`);
      return { status: 'success' };
    } catch (error) {
      return { status: 'error', message: 'Accès au projet non autorisé.' };
    }
  }

  @SubscribeMessage('leave-task')
  async handleLeaveTask(
    @MessageBody() data: { taskId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`task:${data.taskId}`);
    console.log(`Socket ${client.id} a quitté la room task:${data.taskId}`);
    return { status: 'success' };
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @MessageBody() data: { taskId: string; isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    if (!userId) return { status: 'error', message: 'Non authentifié.' };

    client.to(`task:${data.taskId}`).emit('user-typing', {
      taskId: data.taskId,
      userId,
      isTyping: data.isTyping,
    });
    return { status: 'success' };
  }

  @SubscribeMessage('voice-start')
  handleVoiceStart(@ConnectedSocket() client: Socket) {
    client.data.audioChunks = [];
    console.log(`Début du flux de streaming voix pour le client ${client.id}`);
    return { status: 'success' };
  }

  @SubscribeMessage('voice-chunk')
  handleVoiceChunk(
    @MessageBody() chunk: Buffer | ArrayBuffer,
    @ConnectedSocket() client: Socket,
  ) {
    if (!client.data.audioChunks) {
      client.data.audioChunks = [];
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    client.data.audioChunks.push(buffer);
    return { status: 'success', chunksCount: client.data.audioChunks.length };
  }

  @SubscribeMessage('voice-end')
  async handleVoiceEnd(
    @MessageBody() data: { workspaceId: string; projectId: string | null; mimeType?: string; isMock?: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    if (!userId) return { status: 'error', message: 'Non authentifié.' };

    const chunks = client.data.audioChunks || [];
    if (chunks.length === 0) {
      return { status: 'error', message: 'Aucun morceau audio reçu.' };
    }

    console.log(`Fin du flux de streaming voix. Assemblage de ${chunks.length} chunks.`);
    const audioBuffer = Buffer.concat(chunks);
    client.data.audioChunks = []; // Réinitialiser le buffer

    try {
      const result = await this.aiService.transcribeAndAnalyzeVoice(
        userId,
        data.workspaceId,
        data.projectId,
        audioBuffer,
        data.mimeType || 'audio/webm',
        data.isMock ?? false,
      );

      // Renvoyer le résultat à l'utilisateur
      client.emit('voice-result', result);
      return { status: 'success', data: result };
    } catch (err: any) {
      console.error('Erreur lors du traitement de la voix en streaming:', err);
      client.emit('voice-error', { message: err instanceof Error ? err.message : String(err) });
      return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }
}
