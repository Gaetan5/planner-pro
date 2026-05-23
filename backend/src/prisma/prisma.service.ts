import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
    await this.seedDefaultUser();
  }

  private async seedDefaultUser() {
    const defaultUserId = 'default-user-id';
    const user = await this.user.findUnique({
      where: { id: defaultUserId },
    });

    if (!user) {
      await this.user.create({
        data: {
          id: defaultUserId,
          email: 'gaetan@planner.pro',
          name: 'Gaëtan',
        },
      });
      console.log('Default user seeded: Gaëtan (default-user-id)');
    }
  }
}
