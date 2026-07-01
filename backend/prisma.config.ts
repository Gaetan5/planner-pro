/// <reference types="node" />
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    url: process.env.DATABASE_URL || 'mysql://root:root_password@localhost:3306/planner_pro',
  },
  migrations: {
    path: 'prisma/migrations',
  },
});
