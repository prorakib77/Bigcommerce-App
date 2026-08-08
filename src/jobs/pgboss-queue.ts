import { PgBoss } from 'pg-boss';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logging/logger';
import { QUEUES } from './queues';
import type { JobQueue, QueueJobHandle, SendOptions, WorkOptions } from './queue-types';

export const DEAD_LETTER_QUEUE = 'kickflip.dead-letter';

async function ensureQueues(boss: PgBoss): Promise<void> {
  const env = getEnv();

  await boss.createQueue(DEAD_LETTER_QUEUE, {
    retentionSeconds: env.DATA_RETENTION_DAYS * 24 * 60 * 60,
  });

  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, {
      retryLimit: env.IMPORT_MAX_ATTEMPTS,
      retryBackoff: true,
      retryDelay: 5,
      retryDelayMax: 300,
      expireInSeconds: 600,
      retentionSeconds: 30 * 24 * 60 * 60,
      deadLetter: DEAD_LETTER_QUEUE,
    });
  }
}

/** Production job queue: pg-boss against the same PostgreSQL database as the rest of the app. */
export class PgBossQueue implements JobQueue {
  constructor(private readonly boss: PgBoss) {}

  async send<T extends object>(
    queueName: string,
    data: T,
    opts: SendOptions,
  ): Promise<string | null> {
    return this.boss.send(queueName, data, { group: opts.group });
  }

  async cancel(queueName: string, jobId: string): Promise<void> {
    await this.boss.cancel(queueName, jobId);
  }

  async work<T extends object>(
    queueName: string,
    opts: WorkOptions,
    handler: (jobs: QueueJobHandle<T>[]) => Promise<void>,
  ): Promise<void> {
    await this.boss.work<T>(
      queueName,
      {
        localConcurrency: opts.localConcurrency,
        groupConcurrency: opts.groupConcurrency,
        batchSize: opts.batchSize ?? 1,
      },
      handler,
    );
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }
}

let instance: PgBossQueue | undefined;
let startPromise: Promise<PgBossQueue> | undefined;

/**
 * Lazily starts (or returns) the process-wide pg-boss-backed queue. Both the
 * web process (to enqueue) and the worker process (to enqueue + work) call
 * this — `start()` is safe to call from multiple processes concurrently,
 * pg-boss owns its own schema-creation locking.
 */
export async function getPgBossQueue(): Promise<PgBossQueue> {
  if (instance) return instance;
  if (!startPromise) {
    const env = getEnv();
    const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
    boss.on('error', (error: Error) => getLogger().error({ err: error.message }, 'pg-boss error'));

    startPromise = boss
      .start()
      .then(async () => {
        await ensureQueues(boss);
        instance = new PgBossQueue(boss);
        return instance;
      })
      .catch((error: unknown) => {
        startPromise = undefined;
        throw error;
      });
  }
  return startPromise;
}

export async function stopPgBossQueue(): Promise<void> {
  if (instance) {
    await instance.stop();
    instance = undefined;
    startPromise = undefined;
  }
}
