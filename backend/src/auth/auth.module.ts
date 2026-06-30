import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../prisma/prisma.module';

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
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
