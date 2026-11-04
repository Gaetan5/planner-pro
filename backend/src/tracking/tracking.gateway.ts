import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
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
import { SkipThrottle } from '@nestjs/throttler';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { AiService } from '../projects/ai.service';
import { ProjectPermissionsService } from '../projects/project-permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { authenticateSocket, stopSessionWatch } from '../auth/ws-auth';
import { RealtimeService, taskRoom, userRoom } from '../realtime/realtime.service';

/** Limites du flux audio et du débit de messages par socket (S16). */
export const VOICE_CHUNK_MAX_BYTES = 64 * 1024;
export const VOICE_SESSION_MAX_BYTES = 10 * 1024 * 1024;
export const WS_RATE_WINDOW_MS = 10_000;
export const WS_RATE_MAX_MESSAGES = 300;

@SkipThrottle()
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    credentials: true,
  },
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  private readonly logger = new Logger(TrackingGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly trackingService: TrackingService,
    private readonly sessionService: SessionService,
    private readonly aiService: AiService,
    private readonly projectPermissionsService: ProjectPermissionsService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Compteur de messages par socket (fenêtre fixe) : true si la limite est dépassée. */
  private isRateLimited(client: Socket): boolean {
    const now = Date.now();
    const state = (client.data.rate ??= { start: now, count: 0 }) as {
      start: number;
      count: number;
    };
    if (now - state.start >= WS_RATE_WINDOW_MS) {
      state.start = now;
      state.count = 0;
    }
    state.count += 1;
    return state.count > WS_RATE_MAX_MESSAGES;
  }

  private resetAudio(client: Socket) {
    client.data.audioChunks = [];
    client.data.audioBytes = 0;
  }

  async afterInit(server: Server) {
    // Seule gateway du serveur : les services diffusent via RealtimeService (A4)
    this.realtime.attach(server);
    try {
      const pubClient = createClient({
        url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
      });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      server.adapter(createAdapter(pubClient, subClient));
      console.log('Socket.io Redis adapter configuré avec succès.');
    } catch (err: unknown) {
      console.error("Erreur lors de la configuration de l'adaptateur Redis pour le tracking:", err);
    }
  }

  async handleConnection(client: Socket) {
    console.log(`Client connecté : ${client.id}`);

    try {
      // Même vérification que le guard HTTP : jeton d'accès (S3), session active (S7)
      await authenticateSocket(client, this.sessionService);
      client.join(userRoom(client.data.userId));
      console.log(`Client authentifié : ${client.data.userId} (Socket: ${client.id})`);

      // Salons de projet selon les droits effectifs (S16) ; workspace : signaux non sensibles
      const rooms = await this.realtime.roomsForUser(client.data.userId);
      for (const room of [...rooms.projects, ...rooms.workspaces]) {
        client.join(room);
      }

      const activeTracking = await this.trackingService.getActiveTracking(client.data.userId);
      client.emit('active-timer-state', activeTracking);
    } catch (error: unknown) {
      this.logger.error(
        `WebSocket authentication or initialization failed for socket ${client.id}.`,
        error instanceof Error ? error.stack : String(error),
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    stopSessionWatch(client);
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
    if (this.isRateLimited(client)) return { status: 'error', message: 'Trop de messages.' };
    try {
      const log = await this.trackingService.startTracking(userId, data.taskId);
      // Diffuser le nouvel état à TOUS les clients connectés du même utilisateur
      this.server.to(`user:${userId}`).emit('timer-started', log);
      return { status: 'success', data: log };
    } catch (err: unknown) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
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
    } catch (err: unknown) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
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
  async handleJoinTask(@MessageBody() data: { taskId: string }, @ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    if (!userId) return { status: 'error', message: 'Non authentifié.' };
    if (this.isRateLimited(client)) return { status: 'error', message: 'Trop de messages.' };

    const task = await this.prisma.task.findUnique({
      where: { id: data.taskId },
      select: { projectId: true },
    });

    if (!task) return { status: 'error', message: 'Tâche introuvable.' };

    try {
      // Vérifier la permission d'accès au projet
      await this.projectPermissionsService.assertProjectRole(task.projectId, userId, [
        'MANAGER',
        'CONTRIBUTOR',
        'COMMENTER',
        'CLIENT',
      ]);

      client.join(`task:${data.taskId}`);
      console.log(`Socket ${client.id} a rejoint la room task:${data.taskId}`);
      return { status: 'success' };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        return { status: 'error', message: 'Projet introuvable.' };
      }
      if (error instanceof ForbiddenException) {
        return { status: 'error', message: 'Accès au projet non autorisé.' };
      }

      this.logger.error(
        `Unable to authorize socket ${client.id} for task ${data.taskId}.`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        status: 'error',
        message: "Impossible de vérifier l'accès à cette tâche. Réessayez ultérieurement.",
      };
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
    if (this.isRateLimited(client)) return { status: 'error', message: 'Trop de messages.' };

    // Seul un socket ayant rejoint la room (donc autorisé sur le projet) peut signaler une saisie
    if (typeof data?.taskId !== 'string' || !client.rooms.has(taskRoom(data.taskId))) {
      return { status: 'error', message: 'Tâche non rejointe.' };
    }

    client.to(taskRoom(data.taskId)).emit('user-typing', {
      taskId: data.taskId,
      userId,
      isTyping: data.isTyping,
    });
    return { status: 'success' };
  }

  @SubscribeMessage('voice-start')
  handleVoiceStart(@ConnectedSocket() client: Socket) {
    this.resetAudio(client);
    console.log(`Début du flux de streaming voix pour le client ${client.id}`);
    return { status: 'success' };
  }

  @SubscribeMessage('voice-chunk')
  handleVoiceChunk(@MessageBody() chunk: Buffer | ArrayBuffer, @ConnectedSocket() client: Socket) {
    if (this.isRateLimited(client)) {
      this.resetAudio(client);
      return { status: 'error', message: 'Trop de messages.' };
    }
    // Uniquement des données binaires : jamais de texte ni d'objet arbitraire
    if (!Buffer.isBuffer(chunk) && !(chunk instanceof ArrayBuffer)) {
      return { status: 'error', message: 'Format de morceau audio invalide.' };
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const total = ((client.data.audioBytes as number | undefined) ?? 0) + buffer.length;
    if (buffer.length > VOICE_CHUNK_MAX_BYTES || total > VOICE_SESSION_MAX_BYTES) {
      // Au-delà des limites : purge de la session audio et erreur (pas d'accumulation mémoire)
      this.resetAudio(client);
      return { status: 'error', message: 'Flux audio trop volumineux.' };
    }
    if (!client.data.audioChunks) {
      client.data.audioChunks = [];
    }
    client.data.audioChunks.push(buffer);
    client.data.audioBytes = total;
    return { status: 'success', chunksCount: client.data.audioChunks.length };
  }

  @SubscribeMessage('voice-end')
  async handleVoiceEnd(
    @MessageBody()
    data: { workspaceId: string; projectId: string | null; mimeType?: string; isMock?: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    if (!userId) return { status: 'error', message: 'Non authentifié.' };
    if (this.isRateLimited(client)) return { status: 'error', message: 'Trop de messages.' };

    const chunks = client.data.audioChunks || [];
    if (chunks.length === 0) {
      return { status: 'error', message: 'Aucun morceau audio reçu.' };
    }

    console.log(`Fin du flux de streaming voix. Assemblage de ${chunks.length} chunks.`);
    const audioBuffer = Buffer.concat(chunks);
    this.resetAudio(client); // Réinitialiser le buffer

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
    } catch (err: unknown) {
      console.error('Erreur lors du traitement de la voix en streaming:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      client.emit('voice-error', { message: errMsg });
      return { status: 'error', message: errMsg };
    }
  }
}
