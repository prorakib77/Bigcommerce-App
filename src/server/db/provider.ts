import { getEnv } from '@/server/env';

export type DbProvider = 'postgresql' | 'sqlite';

/**
 * The database backend is inferred from `DATABASE_URL`'s scheme rather than
 * a separate toggle: `file:` selects the SQLite local-dev path
 * (`src/jobs/sqlite-queue.ts`, `prisma/schema.sqlite.prisma`); anything else
 * is treated as Postgres (the only backend allowed in production — see
 * `refineEnv` in `src/server/env/schema.ts`).
 */
export function getDbProvider(): DbProvider {
  return getEnv().DATABASE_URL.startsWith('file:') ? 'sqlite' : 'postgresql';
}
