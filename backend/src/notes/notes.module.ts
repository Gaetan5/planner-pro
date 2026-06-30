import { Module } from '@nestjs/common';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

import { GeminiProvider } from './gemini-provider.service';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [NotesService, GeminiProvider],
  controllers: [NotesController],
  exports: [NotesService, GeminiProvider],
})
export class NotesModule {}
