import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { TrackingModule } from './tracking/tracking.module';
import { NotesModule } from './notes/notes.module';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 60,
    }]),
    PrismaModule,
    ProjectsModule,
    TrackingModule,
    NotesModule,
    AuthModule,
    RedisModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
