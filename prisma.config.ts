import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 moved connection strings out of schema.prisma. This file is only
// read by the Prisma CLI (generate/migrate/studio) — the application
// runtime never imports it. Migrations run against DIRECT_DATABASE_URL (an
// unpooled connection) when set, falling back to DATABASE_URL for simple
// setups where they're the same database. The app itself always connects
// via DATABASE_URL through an explicit driver adapter — see
// src/server/db/prisma.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  },
});
