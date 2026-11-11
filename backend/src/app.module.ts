import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { TrackingModule } from './tracking/tracking.module';
import { NotesModule } from './notes/notes.module';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { NotificationsModule } from './notifications/notifications.module';
import { MailModule } from './mail/mail.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { FirestoreSyncModule } from './firestore-sync/firestore-sync.module';

import { AuthzModule } from './authz/authz.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AppThrottlerGuard } from './common/app-throttler.guard';
import { FeatureFlagGuard } from './config/feature-flag.guard';
import { JwtAuthGuard } from './auth/jwt.guard';
import { RetryAfterFilter } from './common/retry-after.filter';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Compteurs dans Redis, partagés entre instances (S24) ; repli mémoire si Redis est indisponible
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60000, limit: 60 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    PrismaModule,
    AuthzModule,
    RealtimeModule,
    ProjectsModule,
    TrackingModule,
    NotesModule,
    AuthModule,
    RedisModule,
    NotificationsModule,
    MailModule,
    AdminModule,
    FirestoreSyncModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 429 par compte (verrouillage) : ajoute `Retry-After` (P7)
    { provide: APP_FILTER, useClass: RetryAfterFilter },
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    // Ordre d'exécution des gardes globaux : débit, drapeau de fonctionnalité (404 avant toute
    // authentification), puis authentification. Toute route est protégée sauf `@Public()` (A1).
    {
      provide: APP_GUARD,
      useClass: FeatureFlagGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
