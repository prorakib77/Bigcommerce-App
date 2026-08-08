import { randomUUID } from 'node:crypto';
import type { ImportRun, ImportStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { AppError } from '@/server/errors/app-error';
import { getQueue } from '@/jobs/queue';
import { QUEUES } from '@/jobs/queues';
import { buildOptionsSnapshot } from '@/jobs/options-snapshot';
import { getOrCreateStoreSettings } from '@/repositories/settings-repository';
import { findMappingByDesign } from '@/repositories/mapping-repository';
import {
  createImportRun,
  findActiveImportRunForDesign,
  findImportRunById,
  listImportRuns,
  cancelQueuedImportRun,
  transitionImportRun,
  type ListImportRunsFilter,
} from '@/repositories/import-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';

export interface EnqueueImportInput {
  storeId: string;
  storeUserId: string;
  kickflipDesignId: string;
  correlationId: string;
  /** Explicit merchant consent to recreate a product for an orphaned mapping. */
  recreate?: boolean;
}

export interface EnqueueImportResult {
  importRunId: string;
  alreadyRunning: boolean;
}

async function enqueueOne(input: EnqueueImportInput): Promise<EnqueueImportResult> {
  const active = await findActiveImportRunForDesign(input.storeId, input.kickflipDesignId);
  if (active) {
    return { importRunId: active.id, alreadyRunning: true };
  }

  const [mapping, settings] = await Promise.all([
    findMappingByDesign(input.storeId, input.kickflipDesignId),
    getOrCreateStoreSettings(input.storeId),
  ]);

  if (mapping?.status === 'ORPHANED' && !input.recreate) {
    throw new AppError('IMPORT_ORPHANED_MAPPING', {
      publicDetail: 'Choose "Recreate product" to explicitly create a new product for this design.',
    });
  }

  const operation =
    mapping?.status === 'ORPHANED' && input.recreate
      ? 'RECREATE_PRODUCT'
      : mapping
        ? 'UPDATE_DESIGN'
        : 'IMPORT_DESIGN';
  const queue = mapping ? QUEUES.UPDATE_DESIGN : QUEUES.IMPORT_DESIGN;

  const importRun = await createImportRun({
    storeId: input.storeId,
    storeUserId: input.storeUserId,
    mappingId: mapping?.id ?? null,
    kickflipDesignId: input.kickflipDesignId,
    operation,
    // Derived from store+design+operation, with a uniquifier so a design
    // can be re-imported after a previous run completes — the DB unique
    // constraint stops literal duplicate rows, while the real
    // duplicate-prevention guarantee is the ImportMapping unique
    // constraint plus the active-run check above.
    idempotencyKey: `${input.storeId}:${input.kickflipDesignId}:${operation}:${randomUUID()}`,
    optionsSnapshot: buildOptionsSnapshot(settings),
    correlationId: input.correlationId,
  });

  const boss = await getQueue();
  const jobId = await boss.send(
    queue,
    { importRunId: importRun.id },
    { group: { id: input.storeId } },
  );

  if (jobId) {
    await prisma.importRun.update({ where: { id: importRun.id }, data: { pgBossJobId: jobId } });
  }

  return { importRunId: importRun.id, alreadyRunning: false };
}

export async function enqueueImports(
  storeId: string,
  storeUserId: string,
  kickflipDesignIds: string[],
  correlationId: string,
  recreate = false,
): Promise<EnqueueImportResult[]> {
  const results: EnqueueImportResult[] = [];
  for (const kickflipDesignId of kickflipDesignIds) {
    results.push(
      await enqueueOne({ storeId, storeUserId, kickflipDesignId, correlationId, recreate }),
    );
  }
  return results;
}

export function getImportRunsPage(filter: ListImportRunsFilter) {
  return listImportRuns(filter);
}

export async function getImportRun(storeId: string, importRunId: string): Promise<ImportRun> {
  const run = await findImportRunById(importRunId);
  if (!run || run.storeId !== storeId) {
    throw new AppError('NOT_FOUND');
  }
  return run;
}

const RETRYABLE_STATUSES: ImportStatus[] = ['FAILED', 'PARTIAL'];

export async function retryImportRun(
  storeId: string,
  storeUserId: string,
  importRunId: string,
  correlationId: string,
): Promise<ImportRun> {
  const run = await getImportRun(storeId, importRunId);
  if (!RETRYABLE_STATUSES.includes(run.status)) {
    throw new AppError('VALIDATION_FAILED', {
      publicDetail: 'Only failed or partial imports can be retried.',
    });
  }

  const updated = await transitionImportRun(run.id, { status: 'QUEUED', currentStage: null });

  const queue = run.operation === 'UPDATE_DESIGN' ? QUEUES.UPDATE_DESIGN : QUEUES.IMPORT_DESIGN;
  const boss = await getQueue();
  const jobId = await boss.send(queue, { importRunId: run.id }, { group: { id: storeId } });
  if (jobId) {
    await prisma.importRun.update({ where: { id: run.id }, data: { pgBossJobId: jobId } });
  }

  await recordAuditEvent({
    storeId,
    storeUserId,
    action: 'import.retried',
    entityType: 'import_run',
    entityId: run.id,
    correlationId,
  });

  return updated;
}

export async function cancelImportRun(
  storeId: string,
  storeUserId: string,
  importRunId: string,
  correlationId: string,
): Promise<ImportRun> {
  const run = await getImportRun(storeId, importRunId);
  const cancelled = await cancelQueuedImportRun(run.id);
  if (!cancelled) {
    throw new AppError('VALIDATION_FAILED', {
      publicDetail: 'Only queued imports that have not started yet can be cancelled.',
    });
  }

  if (run.pgBossJobId) {
    const queue = run.operation === 'UPDATE_DESIGN' ? QUEUES.UPDATE_DESIGN : QUEUES.IMPORT_DESIGN;
    const boss = await getQueue();
    await boss.cancel(queue, run.pgBossJobId).catch(() => undefined);
  }

  await recordAuditEvent({
    storeId,
    storeUserId,
    action: 'import.cancelled',
    entityType: 'import_run',
    entityId: run.id,
    correlationId,
  });

  return cancelled;
}
