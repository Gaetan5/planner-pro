import { Global, Module } from '@nestjs/common';
import { TokenService } from './token.service';

/**
 * Module global : JwtAuthGuard (utilisé dans tous les modules) et les gateways WebSocket
 * s'appuient sur TokenService.
 */
@Global()
@Module({
  providers: [TokenService],
  exports: [TokenService],
})
export class TokenModule {}
