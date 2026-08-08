import { getDbProvider } from '@/server/db/provider';
import { getPgBossQueue, stopPgBossQueue } from './pgboss-queue';
import { getSqliteQueue, stopSqliteQueue } from './sqlite-queue';
import type { JobQueue } from './queue-types';

/**
 * Returns the job queue for whichever backend is active — `pg-boss` against
 * Postgres in production, or the hand-built SQLite queue for local dev (see
 * `src/server/db/provider.ts`). `src/jobs/worker.ts` and
 * `src/services/import-service.ts` are the only other callers and don't
 * need to know which one they got.
 */
export async function getQueue(): Promise<JobQueue> {
  return getDbProvider() === 'sqlite' ? getSqliteQueue() : getPgBossQueue();
}

export async function stopQueue(): Promise<void> {
  if (getDbProvider() === 'sqlite') {
    await stopSqliteQueue();
  } else {
    await stopPgBossQueue();
  }
}
