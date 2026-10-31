import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SkipThrottle } from '@nestjs/throttler';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { authenticateSocket, stopSessionWatch } from '../auth/ws-auth';

@SkipThrottle()
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessionService: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async afterInit(server: Server) {
    try {
      const pubClient = createClient({
        url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
      });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      server.adapter(createAdapter(pubClient, subClient));
      console.log('Notifications Gateway: Socket.io Redis adapter configuré.');
    } catch (e) {
      console.error(
        "Erreur lors de la configuration de l'adaptateur Redis pour les notifications:",
        e,
      );
    }
  }

  async handleConnection(client: Socket) {
    try {
      // Même vérification que le guard HTTP : jeton d'accès (S3), session active (S7)
      await authenticateSocket(client, this.sessionService);
      client.join(`user:${client.data.userId}`);
      console.log(
        `Notifications Gateway: Client connecté et authentifié : ${client.data.userId} (Socket: ${client.id})`,
      );

      // Rejoindre les salons de workspace associés
      const userWorkspaces = await this.prisma.membership.findMany({
        where: { userId: client.data.userId },
        select: { workspaceId: true },
      });
      for (const membership of userWorkspaces) {
        client.join(`workspace:${membership.workspaceId}`);
        console.log(
          `Notifications Gateway: Socket ${client.id} a rejoint la room workspace:${membership.workspaceId}`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Socket ${client.id} authentication or workspace initialization failed.`,
        error instanceof Error ? error.stack : String(error),
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    stopSessionWatch(client);
    console.log(`Notifications Gateway: Client déconnecté : ${client.id}`);
  }

  sendNotificationToUser(userId: string, event: string, data: unknown) {
    if (this.server) {
      this.server.to(`user:${userId}`).emit(event, data);
    }
  }
}
