import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { getEnv } from '@/server/env';
import { getDbProvider } from './provider';

declare global {
  var __prisma: PrismaClient | undefined;
}

interface SqliteAdapterModule {
  PrismaBetterSqlite3: new (config: { url: string }) => unknown;
}

interface SqliteClientModule {
  PrismaClient: new (config: { adapter: unknown; log: string[] }) => PrismaClient;
}

/**
 * The SQLite-generated client (prisma/schema.sqlite.prisma, local dev only)
 * lives at node_modules/.prisma/client-sqlite — a path Node's ESM loader
 * rejects as an import specifier (leading-dot bare specifiers aren't valid
 * package names), and one that only exists on disk for developers who've
 * run `pnpm db:generate:sqlite`. Both the adapter and the generated client
 * are therefore loaded lazily via `require`, strictly inside this branch —
 * never a static top-level import — so that:
 *   - Postgres/production mode never references either module.
 *   - Next.js's bundler never tries to statically resolve/bundle the native
 *     `better-sqlite3` addon (see next.config.mjs's serverExternalPackages,
 *     kept as defense in depth for `next dev`/`next build` on a machine
 *     that does have it installed).
 * `@prisma/adapter-better-sqlite3` is a devDependency for the same reason —
 * production's `pnpm install` (NODE_ENV=production, see Dockerfile) skips
 * devDependencies entirely, so it's never installed or compiled there.
 */
function createSqlitePrismaClient(url: string): PrismaClient {
  const require = createRequire(import.meta.url);
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3') as SqliteAdapterModule;
  const { PrismaClient: SqlitePrismaClient } =
    require('.prisma/client-sqlite') as SqliteClientModule;

  const adapter = new PrismaBetterSqlite3({ url });
  return new SqlitePrismaClient({ adapter, log: ['error', 'warn'] });
}

function createPrismaClient(): PrismaClient {
  const env = getEnv();

  if (getDbProvider() === 'sqlite') {
    return createSqlitePrismaClient(env.DATABASE_URL);
  }

  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: ['error', 'warn'],
  });
}

/**
 * Singleton Prisma client (Prisma 7 requires an explicit driver adapter —
 * there is no implicit schema-level connection URL anymore). In
 * development, Next.js hot-reloading would otherwise create a new
 * PrismaClient — and a new connection pool — on every module reload, so the
 * instance is stashed on `globalThis`.
 */
export const prisma: PrismaClient = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
