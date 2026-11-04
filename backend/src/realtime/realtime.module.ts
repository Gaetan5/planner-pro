import { Global, Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

/** Module global : diffusion temps réel injectable partout (A4). */
@Global()
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
