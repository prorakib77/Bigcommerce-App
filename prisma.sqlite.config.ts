import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// SQLite counterpart to prisma.config.ts, used only for local dev CLI
// operations (`pnpm db:generate:sqlite`, `pnpm db:migrate:sqlite`, etc. —
// see package.json). Only read by the Prisma CLI, never imported by the
// application runtime. A local file database needs no pooled/direct URL
// split, so this always uses DATABASE_URL directly.
export default defineConfig({
  schema: 'prisma/schema.sqlite.prisma',
  migrations: {
    path: 'prisma/migrations-sqlite',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
