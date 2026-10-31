/// <reference types="node" />
import { defineConfig } from 'prisma/config';
import { resolveCliDatasourceUrl } from './src/prisma/database-url';

export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    // Aucun repli root hors development/test ; TLS strict si DATABASE_SSL=true (audit S4)
    url: resolveCliDatasourceUrl(process.env),
  },
  migrations: {
    path: 'prisma/migrations',
  },
});
