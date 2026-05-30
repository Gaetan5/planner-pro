import { Module } from '@nestjs/common';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

import { GeminiService } from './gemini.service';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [NotesService, GeminiService],
  controllers: [NotesController],
  exports: [NotesService],
})
export class NotesModule {}
