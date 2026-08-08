import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import { resetDatabase } from '@/test/helpers/db-reset';
import { seedStore } from '@/test/factories/store-factory';
import { enqueueImports } from '@/services/import-service';
import { runImportJob } from '@/jobs/handlers/import-design';
import { findMappingByDesign } from '@/repositories/mapping-repository';
import { __resetEnvCacheForTests } from '@/server/env';

const ORIGINAL_ALLOWED_HOSTS = process.env.KICKFLIP_ALLOWED_IMAGE_HOSTS;

beforeEach(async () => {
  await resetDatabase();
  // Restricts the image host allowlist to something the mock Kickflip
  // fixtures' image URLs never match, so every image in this file fails
  // fast via IMAGE_HOST_NOT_ALLOWED — deterministic and network-free —
  // instead of depending on real DNS/HTTP behavior for a partial-import
  // test. `getEnv()` memoizes its result, so the cache must be reset after
  // mutating process.env for the new value to actually take effect.
  process.env.KICKFLIP_ALLOWED_IMAGE_HOSTS = 'not-the-mock-cdn.example.com';
  __resetEnvCacheForTests();
});

afterEach(() => {
  process.env.KICKFLIP_ALLOWED_IMAGE_HOSTS = ORIGINAL_ALLOWED_HOSTS;
  __resetEnvCacheForTests();
});

describe('Import flow: partial failure on images', () => {
  it('still creates the product and mapping, but marks the run PARTIAL when every image is rejected', async () => {
    const { store, owner } = await seedStore({ importImages: true });

    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-1');
    const run = await prisma.importRun.findFirstOrThrow({
      where: { storeId: store.id, kickflipDesignId: 'design-1' },
      orderBy: { createdAt: 'desc' },
    });

    await runImportJob(run.id, new AbortController().signal).catch(() => undefined);
    const finished = await prisma.importRun.findUniqueOrThrow({ where: { id: run.id } });

    expect(finished.status).toBe('PARTIAL');
    expect(finished.safeErrorCode).toBe('IMAGE_UPLOAD_FAILED');
    expect(finished.bigcommerceProductId).toBeTypeOf('number');

    const mapping = await findMappingByDesign(store.id, 'design-1');
    expect(mapping).not.toBeNull();
    expect(mapping!.status).toBe('ACTIVE');
  });

  it('retrying after a partial failure never creates a second product', async () => {
    const { store, owner } = await seedStore({ importImages: true });
    await enqueueImports(store.id, owner.id, ['design-1'], 'corr-1');
    const firstRun = await prisma.importRun.findFirstOrThrow({
      where: { storeId: store.id, kickflipDesignId: 'design-1' },
      orderBy: { createdAt: 'desc' },
    });
    await runImportJob(firstRun.id, new AbortController().signal).catch(() => undefined);
    const afterFirst = await prisma.importRun.findUniqueOrThrow({ where: { id: firstRun.id } });
    expect(afterFirst.status).toBe('PARTIAL');

    // Retry: re-run the SAME import run (as the retry service does), not a new one.
    await prisma.importRun.update({ where: { id: firstRun.id }, data: { status: 'QUEUED' } });
    await runImportJob(firstRun.id, new AbortController().signal).catch(() => undefined);
    const afterRetry = await prisma.importRun.findUniqueOrThrow({ where: { id: firstRun.id } });

    expect(afterRetry.bigcommerceProductId).toBe(afterFirst.bigcommerceProductId);

    const mappingCount = await prisma.importMapping.count({
      where: { storeId: store.id, kickflipDesignId: 'design-1' },
    });
    expect(mappingCount).toBe(1);
  });
});
