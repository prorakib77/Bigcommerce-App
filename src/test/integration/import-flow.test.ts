import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import { resetDatabase } from '@/test/helpers/db-reset';
import { seedStore } from '@/test/factories/store-factory';
import { enqueueImports } from '@/services/import-service';
import { runImportJob } from '@/jobs/handlers/import-design';
import { findMappingByDesign } from '@/repositories/mapping-repository';

beforeEach(() => resetDatabase());

async function runFirstQueuedJob(storeId: string, kickflipDesignId: string) {
  const run = await prisma.importRun.findFirstOrThrow({
    where: { storeId, kickflipDesignId, status: 'QUEUED' },
    orderBy: { createdAt: 'desc' },
  });
  const controller = new AbortController();
  // runImportJob persists failure state and then re-throws (matching the
  // pg-boss contract: throw = job failed, subject to the queue's retry
  // policy) — tests assert on the persisted ImportRun row, not the throw.
  await runImportJob(run.id, controller.signal).catch(() => undefined);
  return prisma.importRun.findUniqueOrThrow({ where: { id: run.id } });
}

describe('Import flow: new design', () => {
  it('creates a mapping and marks the run SUCCEEDED', async () => {
    const { store, owner } = await seedStore();

    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-1');
    const finished = await runFirstQueuedJob(store.id, 'design-1');

    expect(finished.status).toBe('SUCCEEDED');
    expect(finished.bigcommerceProductId).toBeTypeOf('number');

    const mapping = await findMappingByDesign(store.id, 'design-1');
    expect(mapping).not.toBeNull();
    expect(mapping!.bigcommerceProductId).toBe(finished.bigcommerceProductId);
    expect(mapping!.status).toBe('ACTIVE');
  });
});

describe('Import flow: duplicate prevention', () => {
  it('skips a re-import with an unchanged fingerprint and does not create a second product', async () => {
    const { store, owner } = await seedStore();

    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-1');
    const first = await runFirstQueuedJob(store.id, 'design-1');

    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-2');
    const second = await runFirstQueuedJob(store.id, 'design-1');

    expect(second.status).toBe('SKIPPED');
    expect(second.bigcommerceProductId).toBe(first.bigcommerceProductId);

    const mappingCount = await prisma.importMapping.count({
      where: { storeId: store.id, kickflipDesignId: 'design-1' },
    });
    expect(mappingCount).toBe(1);
  });

  it('enforces one mapping per design at the database level', async () => {
    const { store } = await seedStore();
    await prisma.importMapping.create({
      data: {
        storeId: store.id,
        kickflipDesignId: 'design-1',
        bigcommerceProductId: 1,
        sourceFingerprint: 'fp',
        status: 'ACTIVE',
      },
    });

    await expect(
      prisma.importMapping.create({
        data: {
          storeId: store.id,
          kickflipDesignId: 'design-1',
          bigcommerceProductId: 2,
          sourceFingerprint: 'fp2',
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('Import flow: changed design updates the existing product', () => {
  it('updates product fields and refreshes the mapping fingerprint', async () => {
    const { store, owner } = await seedStore();

    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-1');
    const first = await runFirstQueuedJob(store.id, 'design-1');

    // Simulate the source having changed since the last import.
    await prisma.importMapping.updateMany({
      where: { storeId: store.id, kickflipDesignId: 'design-1' },
      data: { sourceFingerprint: 'stale-fingerprint' },
    });

    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-2');
    const second = await runFirstQueuedJob(store.id, 'design-1');

    expect(second.status).toBe('SUCCEEDED');
    expect(second.operation).toBe('UPDATE_DESIGN');
    expect(second.bigcommerceProductId).toBe(first.bigcommerceProductId);

    const mapping = await findMappingByDesign(store.id, 'design-1');
    expect(mapping!.sourceFingerprint).not.toBe('stale-fingerprint');
  });
});

describe('Import flow: orphaned mapping', () => {
  it('fails a routine re-import when the mapped product is gone, without recreating it', async () => {
    const { store, owner } = await seedStore();
    await prisma.importMapping.create({
      data: {
        storeId: store.id,
        kickflipDesignId: 'design-1',
        bigcommerceProductId: 999_999, // never created via the mock catalog service
        sourceFingerprint: 'fp',
        status: 'ACTIVE',
      },
    });

    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-1');
    const finished = await runFirstQueuedJob(store.id, 'design-1');

    expect(finished.status).toBe('FAILED');
    expect(finished.safeErrorCode).toBe('IMPORT_ORPHANED_MAPPING');

    const mapping = await findMappingByDesign(store.id, 'design-1');
    expect(mapping!.status).toBe('ORPHANED');
  });

  it('recreates the product when the merchant explicitly requests it', async () => {
    const { store, owner } = await seedStore();
    await prisma.importMapping.create({
      data: {
        storeId: store.id,
        kickflipDesignId: 'design-1',
        bigcommerceProductId: 999_999,
        sourceFingerprint: 'fp',
        status: 'ORPHANED',
        orphaned: true,
      },
    });

    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-1', true);
    const finished = await runFirstQueuedJob(store.id, 'design-1');

    expect(finished.status).toBe('SUCCEEDED');
    expect(finished.bigcommerceProductId).not.toBe(999_999);

    const mapping = await findMappingByDesign(store.id, 'design-1');
    expect(mapping!.status).toBe('ACTIVE');
    expect(mapping!.bigcommerceProductId).toBe(finished.bigcommerceProductId);
  });
});

describe('Import flow: inactive store', () => {
  it('fails the job without calling BigCommerce when the store was deactivated after enqueue', async () => {
    const { store, owner } = await seedStore();
    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-1');
    await prisma.store.update({ where: { id: store.id }, data: { isActive: false } });

    const finished = await runFirstQueuedJob(store.id, 'design-1');
    expect(finished.status).toBe('FAILED');
    expect(finished.safeErrorCode).toBe('STORE_INACTIVE');

    const mapping = await findMappingByDesign(store.id, 'design-1');
    expect(mapping).toBeNull();
  });
});
