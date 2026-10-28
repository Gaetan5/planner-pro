import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { FirebaseIdentityService } from './firebase-identity.service';
import { JwtAuthGuard } from './jwt.guard';
import { SsoService } from './sso/sso.service';
import { SsoController } from './sso/sso.controller';
import { ScimService } from './scim/scim.service';
import { ScimController } from './scim/scim.controller';
import { ScimAuthGuard } from './scim/scim.guard';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot(),
    JwtModule.register({
      global: true,
      secret: (() => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error(
            "La variable d'environnement JWT_SECRET est obligatoire mais absente (Fail-Fast).",
          );
        }
        return secret;
      })(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [
    AuthService,
    FirebaseIdentityService,
    JwtAuthGuard,
    SsoService,
    ScimService,
    ScimAuthGuard,
  ],
  controllers: [AuthController, SsoController, ScimController],
  exports: [AuthService, JwtAuthGuard, SsoService, ScimService],
})
export class AuthModule {}
