import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logging/logger';
import { getQueue, stopQueue } from './queue';
import { QUEUES, type ImportJobPayload } from './queues';
import { runImportJob } from './handlers/import-design';
import { runRetryImagesJob } from './handlers/retry-images';
import { runReconcileMappingJob } from './handlers/reconcile-mapping';
import type { QueueJobHandle } from './queue-types';

const logger = getLogger().child({ process: 'worker' });

function firstJob<T extends object>(jobs: QueueJobHandle<T>[]): QueueJobHandle<T> {
  const job = jobs[0];
  if (!job) throw new Error('Worker invoked with an empty job batch');
  return job;
}

async function main(): Promise<void> {
  const env = getEnv();
  const boss = await getQueue();

  const perStoreConcurrency = { default: env.IMPORT_PER_STORE_CONCURRENCY };

  await boss.work<ImportJobPayload>(
    QUEUES.IMPORT_DESIGN,
    {
      localConcurrency: env.IMPORT_GLOBAL_CONCURRENCY,
      groupConcurrency: perStoreConcurrency,
      batchSize: 1,
    },
    async (jobs: QueueJobHandle<ImportJobPayload>[]) => {
      const job = firstJob(jobs);
      await runImportJob(job.data.importRunId, job.signal);
    },
  );

  await boss.work<ImportJobPayload>(
    QUEUES.UPDATE_DESIGN,
    {
      localConcurrency: env.IMPORT_GLOBAL_CONCURRENCY,
      groupConcurrency: perStoreConcurrency,
      batchSize: 1,
    },
    async (jobs: QueueJobHandle<ImportJobPayload>[]) => {
      const job = firstJob(jobs);
      await runImportJob(job.data.importRunId, job.signal);
    },
  );

  await boss.work<ImportJobPayload>(
    QUEUES.RETRY_IMAGES,
    {
      localConcurrency: Math.max(2, Math.floor(env.IMPORT_GLOBAL_CONCURRENCY / 2)),
      groupConcurrency: perStoreConcurrency,
      batchSize: 1,
    },
    async (jobs: QueueJobHandle<ImportJobPayload>[]) => {
      const job = firstJob(jobs);
      await runRetryImagesJob(job.data.importRunId, job.signal);
    },
  );

  await boss.work<ImportJobPayload>(
    QUEUES.RECONCILE_MAPPING,
    { localConcurrency: 2, batchSize: 1 },
    async (jobs: QueueJobHandle<ImportJobPayload>[]) => {
      const job = firstJob(jobs);
      await runReconcileMappingJob(job.data.importRunId);
    },
  );

  logger.info(
    {
      queues: Object.values(QUEUES),
      globalConcurrency: env.IMPORT_GLOBAL_CONCURRENCY,
      perStoreConcurrency: env.IMPORT_PER_STORE_CONCURRENCY,
    },
    'Worker ready',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Worker shutting down gracefully');
    try {
      await stopQueue();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error(
    { err: error instanceof Error ? error.message : String(error) },
    'Worker failed to start',
  );
  process.exit(1);
});
