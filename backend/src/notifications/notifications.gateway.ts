import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { PrismaService } from '../prisma/prisma.service';

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
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
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
    let token = client.handshake.auth?.token || client.handshake.headers?.authorization;
    if (token && token.startsWith('Bearer ')) {
      token = token.slice(7);
    }

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      client.data.userId = payload.sub;
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
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Notifications Gateway: Client déconnecté : ${client.id}`);
  }

  sendNotificationToUser(userId: string, event: string, data: unknown) {
    if (this.server) {
      this.server.to(`user:${userId}`).emit(event, data);
    }
  }
}
