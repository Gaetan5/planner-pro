import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { SessionService } from './session.service';

/**
 * Module global : JwtAuthGuard (utilisé dans tous les modules) et les gateways WebSocket
 * s'appuient sur SessionService (A3, S7).
 */
@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
