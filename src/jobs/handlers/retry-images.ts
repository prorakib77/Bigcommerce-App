import { getLogger } from '@/server/logging/logger';
import { AppError, toAppError } from '@/server/errors/app-error';
import { decryptSecret } from '@/server/crypto/encryption';
import { findStoreById } from '@/repositories/store-repository';
import { findImportRunById, transitionImportRun } from '@/repositories/import-repository';
import {
  findMappingById,
  updateMappingAfterImport,
  markMappingOrphaned,
} from '@/repositories/mapping-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';
import { resolveKickflipCredentials } from '@/services/connection-service';
import { createKickflipClient } from '@/lib/kickflip';
import { createCatalogService } from '@/lib/bigcommerce/catalog-service';
import { ingestDesignImages } from '@/lib/images';
import type { ImportOptionsSnapshot } from '@/jobs/options-snapshot';

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError('IMPORT_CANCELLED');
}

/**
 * Re-attempts only the image step for an already-imported design. Does not
 * touch product fields and never creates a product — used when a prior
 * import succeeded but left some images failed (PARTIAL), or when the
 * merchant explicitly asks to retry image processing.
 */
export async function runRetryImagesJob(importRunId: string, signal: AbortSignal): Promise<void> {
  const logger = getLogger().child({ importRunId, job: 'retry-images' });

  const run = await findImportRunById(importRunId);
  if (!run || !run.mappingId) {
    logger.error('ImportRun or its mapping not found — nothing to do');
    return;
  }

  const [store, mapping] = await Promise.all([
    findStoreById(run.storeId),
    findMappingById(run.mappingId),
  ]);
  if (!store || !store.isActive) {
    await transitionImportRun(run.id, {
      status: 'FAILED',
      safeErrorCode: 'STORE_INACTIVE',
      safeErrorMessage: 'This store is no longer active.',
      finishedAt: new Date(),
    });
    return;
  }
  if (!mapping || mapping.status === 'ORPHANED') {
    await transitionImportRun(run.id, {
      status: 'FAILED',
      safeErrorCode: 'IMPORT_ORPHANED_MAPPING',
      safeErrorMessage: 'The mapped BigCommerce product no longer exists.',
      finishedAt: new Date(),
    });
    return;
  }

  const options = run.optionsSnapshot as unknown as ImportOptionsSnapshot;

  try {
    await transitionImportRun(run.id, {
      status: 'PROCESSING_IMAGES',
      currentStage: 'PROCESSING_IMAGES',
      startedAt: run.startedAt ?? new Date(),
      incrementAttempt: true,
      bigcommerceProductId: mapping.bigcommerceProductId,
    });
    checkAborted(signal);

    const kickflipCredentials = await resolveKickflipCredentials(run.storeId);
    const kickflipClient = createKickflipClient(kickflipCredentials, { logger });
    const design = await kickflipClient.getDesign(run.kickflipDesignId, run.correlationId, signal);

    const accessToken = decryptSecret(store.encryptedAccessToken);
    const catalogService = createCatalogService({
      storeHash: store.storeHash,
      accessToken,
      correlationId: run.correlationId,
      logger,
    });

    const product = await catalogService.getProduct(mapping.bigcommerceProductId);
    if (!product) {
      await markMappingOrphaned(mapping.id);
      throw new AppError('IMPORT_ORPHANED_MAPPING');
    }

    const existingImages = await catalogService.listProductImages(mapping.bigcommerceProductId);
    const remainingSlots = options.maxImagesPerDesign - existingImages.length;
    const candidateUrls = (
      design.imageUrls.length > 0
        ? design.imageUrls
        : design.primaryImageUrl
          ? [design.primaryImageUrl]
          : []
    ).slice(0, Math.max(remainingSlots, 0));

    const result =
      candidateUrls.length > 0
        ? await ingestDesignImages({
            catalogService,
            productId: mapping.bigcommerceProductId,
            imageUrls: candidateUrls,
            maxImages: Math.max(remainingSlots, 0),
            correlationId: run.correlationId,
            logger,
            existingImageCount: existingImages.length,
          })
        : { uploaded: [], failed: [] };

    await updateMappingAfterImport(mapping.id, {
      sourceFingerprint: mapping.sourceFingerprint,
      sourceUpdatedAt: mapping.sourceUpdatedAt,
      successful: true,
    });

    const finalStatus = result.failed.length > 0 ? 'PARTIAL' : 'SUCCEEDED';
    await transitionImportRun(run.id, {
      status: finalStatus,
      currentStage: finalStatus,
      bigcommerceProductId: mapping.bigcommerceProductId,
      finishedAt: new Date(),
      safeErrorCode: result.failed.length > 0 ? 'IMAGE_UPLOAD_FAILED' : null,
      safeErrorMessage:
        result.failed.length > 0
          ? `${result.failed.length} image(s) still failed to upload.`
          : null,
    });

    await recordAuditEvent({
      storeId: run.storeId,
      storeUserId: run.storeUserId,
      action: 'import.images_retried',
      entityType: 'import_run',
      entityId: run.id,
      metadata: { uploaded: result.uploaded.length, failed: result.failed.length },
      correlationId: run.correlationId,
    });
  } catch (error) {
    const appError = toAppError(error);
    logger.error(
      { code: appError.code, internalRef: appError.internalRef },
      'Retry-images job failed',
    );
    await transitionImportRun(run.id, {
      status: 'FAILED',
      currentStage: 'FAILED',
      safeErrorCode: appError.code,
      safeErrorMessage: appError.message,
      internalErrorRef: appError.internalRef,
      finishedAt: new Date(),
    });
    throw error;
  }
}
