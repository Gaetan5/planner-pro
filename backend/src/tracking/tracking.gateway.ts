import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TrackingService } from './tracking.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly defaultUserId = 'default-user-id';

  constructor(private readonly trackingService: TrackingService) {}

  async handleConnection(client: Socket) {
    console.log(`Client connecté : ${client.id}`);
    // Envoyer l'état du timer actif au nouveau client connecté
    const activeTracking = await this.trackingService.getActiveTracking(this.defaultUserId);
    client.emit('active-timer-state', activeTracking);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client déconnecté : ${client.id}`);
  }

  @SubscribeMessage('start-timer')
  async handleStartTimer(
    @MessageBody() data: { taskId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const log = await this.trackingService.startTracking(this.defaultUserId, data.taskId);
      // Diffuser le nouvel état à TOUS les clients connectés
      this.server.emit('timer-started', log);
      return { status: 'success', data: log };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('stop-timer')
  async handleStopTimer(@ConnectedSocket() client: Socket) {
    try {
      const log = await this.trackingService.stopActiveTracking(this.defaultUserId);
      // Diffuser l'arrêt à TOUS les clients connectés
      this.server.emit('timer-stopped', log);
      return { status: 'success', data: log };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('request-active-timer')
  async handleRequestActiveTimer(@ConnectedSocket() client: Socket) {
    const activeTracking = await this.trackingService.getActiveTracking(this.defaultUserId);
    client.emit('active-timer-state', activeTracking);
  }
}
