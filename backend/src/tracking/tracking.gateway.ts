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

@SkipThrottle()
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    credentials: true,
  },
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly trackingService: TrackingService,
    private readonly jwtService: JwtService,
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
    } catch (error) {
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
    } catch (error) {
      return { status: 'error', message: error.message };
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
    } catch (error) {
      return { status: 'error', message: error.message };
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
    client.join(`task:${data.taskId}`);
    console.log(`Socket ${client.id} a rejoint la room task:${data.taskId}`);
    return { status: 'success' };
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
}
