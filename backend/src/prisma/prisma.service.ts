import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const dbUrl =
      process.env.DATABASE_URL || 'mysql://root:root_password@localhost:3306/planner_pro';
    const parsed = new URL(dbUrl);
    const adapter = new PrismaMariaDb({
      host: parsed.hostname,
      port: parseInt(parsed.port || '3306', 10),
      user: parsed.username,
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.substring(1),
    });
    super({ adapter });
  }

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
