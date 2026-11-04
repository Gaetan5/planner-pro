import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PolicyService } from './policy.service';

/** Module global : la politique d'autorisation est injectable partout (A2). */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class AuthzModule {}
