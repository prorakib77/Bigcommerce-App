/**
 * Backend-agnostic job queue contract. Deliberately mirrors pg-boss's own
 * `send`/`cancel`/`work` shapes (down to option field names) so
 * `src/jobs/worker.ts` and `src/services/import-service.ts` don't need to
 * change beyond their import source — see `src/jobs/queue.ts`,
 * `src/jobs/pgboss-queue.ts` (production, Postgres), and
 * `src/jobs/sqlite-queue.ts` (local dev only, no Postgres/pg-boss required).
 */

export interface QueueJobHandle<T> {
  data: T;
  signal: AbortSignal;
}

export interface WorkOptions {
  /** Max jobs this process runs concurrently for this queue. */
  localConcurrency: number;
  /** Max jobs per `group.id` (this app always groups by storeId). */
  groupConcurrency?: { default: number };
  /** This app always processes one job per handler invocation. */
  batchSize?: number;
}

export interface SendOptions {
  group: { id: string };
}

export interface JobQueue {
  send<T extends object>(queueName: string, data: T, opts: SendOptions): Promise<string | null>;
  cancel(queueName: string, jobId: string): Promise<void>;
  work<T extends object>(
    queueName: string,
    opts: WorkOptions,
    handler: (jobs: QueueJobHandle<T>[]) => Promise<void>,
  ): Promise<void>;
  stop(): Promise<void>;
}
