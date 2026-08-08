import { getLogger } from '@/server/logging/logger';
import { toAppError } from '@/server/errors/app-error';
import { decryptSecret } from '@/server/crypto/encryption';
import { findStoreById } from '@/repositories/store-repository';
import { findImportRunById, transitionImportRun } from '@/repositories/import-repository';
import { findMappingById, markMappingOrphaned } from '@/repositories/mapping-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';
import { createCatalogService } from '@/lib/bigcommerce/catalog-service';

/**
 * Verifies a mapping's BigCommerce product still exists. Never creates or
 * deletes a product — only flips the mapping to `ORPHANED` when the
 * product is confirmed gone (404), giving the merchant an explicit
 * "Recreate product" recovery action instead of silently re-importing.
 */
export async function runReconcileMappingJob(importRunId: string): Promise<void> {
  const logger = getLogger().child({ importRunId, job: 'reconcile-mapping' });

  const run = await findImportRunById(importRunId);
  if (!run || !run.mappingId) {
    logger.error('ImportRun or its mapping not found — nothing to do');
    return;
  }

  const [store, mapping] = await Promise.all([
    findStoreById(run.storeId),
    findMappingById(run.mappingId),
  ]);
  if (!store || !store.isActive || !mapping) {
    await transitionImportRun(run.id, { status: 'CANCELLED', finishedAt: new Date() });
    return;
  }

  try {
    const catalogService = createCatalogService({
      storeHash: store.storeHash,
      accessToken: decryptSecret(store.encryptedAccessToken),
      correlationId: run.correlationId,
      logger,
    });

    const product = await catalogService.getProduct(mapping.bigcommerceProductId);

    if (!product) {
      await markMappingOrphaned(mapping.id);
      await recordAuditEvent({
        storeId: run.storeId,
        action: 'mapping.orphaned',
        entityType: 'import_mapping',
        entityId: mapping.id,
        correlationId: run.correlationId,
      });
    }

    await transitionImportRun(run.id, {
      status: 'SUCCEEDED',
      currentStage: 'SUCCEEDED',
      bigcommerceProductId: mapping.bigcommerceProductId,
      finishedAt: new Date(),
    });
  } catch (error) {
    const appError = toAppError(error);
    await transitionImportRun(run.id, {
      status: 'FAILED',
      safeErrorCode: appError.code,
      safeErrorMessage: appError.message,
      internalErrorRef: appError.internalRef,
      finishedAt: new Date(),
    });
    throw error;
  }
}
