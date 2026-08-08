import type { ImportStatus } from '@prisma/client';
import { getLogger } from '@/server/logging/logger';
import { AppError, toAppError } from '@/server/errors/app-error';
import { decryptSecret } from '@/server/crypto/encryption';
import { findStoreById } from '@/repositories/store-repository';
import { findImportRunById, transitionImportRun } from '@/repositories/import-repository';
import {
  findMappingById,
  findMappingByDesign,
  createMapping,
  updateMappingAfterImport,
  markMappingOrphaned,
} from '@/repositories/mapping-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';
import { resolveKickflipCredentials } from '@/services/connection-service';
import { buildProductDescriptionHtml } from '@/services/description-builder';
import { generateSku } from '@/services/sku';
import { createKickflipClient } from '@/lib/kickflip';
import { createCatalogService } from '@/lib/bigcommerce/catalog-service';
import type { UpdateProductInput } from '@/lib/bigcommerce/catalog';
import { ingestDesignImages, type FailedImage } from '@/lib/images';
import type { ImportOptionsSnapshot } from '@/jobs/options-snapshot';

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AppError('IMPORT_CANCELLED');
  }
}

/**
 * The core import/update stage machine, shared by the
 * `kickflip.import-design` and `kickflip.update-design` queues. Resumable
 * by design: every DB write happens before the next external call, and the
 * handler re-derives its starting point from the ImportRun row on every
 * invocation, so a retry after a crash/failure never re-creates a
 * BigCommerce product that already exists.
 */
export async function runImportJob(importRunId: string, signal: AbortSignal): Promise<void> {
  const logger = getLogger().child({ importRunId, job: 'import-design' });

  const run = await findImportRunById(importRunId);
  if (!run) {
    logger.error('ImportRun row not found — nothing to do');
    return;
  }

  const store = await findStoreById(run.storeId);
  if (!store || !store.isActive) {
    await transitionImportRun(run.id, {
      status: 'FAILED',
      currentStage: 'FAILED',
      safeErrorCode: 'STORE_INACTIVE',
      safeErrorMessage: 'This store is no longer active.',
      finishedAt: new Date(),
    });
    return;
  }

  // Captured before any mutation: tells us whether an EARLIER attempt of
  // this same run already created/updated the BigCommerce product.
  const hadExistingProgress = run.bigcommerceProductId != null;
  const options = run.optionsSnapshot as unknown as ImportOptionsSnapshot;

  try {
    await transitionImportRun(run.id, {
      status: 'FETCHING_SOURCE',
      currentStage: 'FETCHING_SOURCE',
      startedAt: run.startedAt ?? new Date(),
      incrementAttempt: true,
    });
    checkAborted(signal);

    const kickflipCredentials = await resolveKickflipCredentials(run.storeId);
    const kickflipClient = createKickflipClient(kickflipCredentials, { logger });
    const design = await kickflipClient.getDesign(run.kickflipDesignId, run.correlationId, signal);

    await transitionImportRun(run.id, {
      status: 'VALIDATING_SOURCE',
      currentStage: 'VALIDATING_SOURCE',
      sourceFingerprint: design.rawFingerprint,
    });
    checkAborted(signal);

    const accessToken = decryptSecret(store.encryptedAccessToken);
    const catalogService = createCatalogService({
      storeHash: store.storeHash,
      accessToken,
      correlationId: run.correlationId,
      logger,
    });

    if (design.currencyCode) {
      const storeCurrency = await catalogService.getStoreCurrencyCode();
      if (design.currencyCode.toUpperCase() !== storeCurrency.toUpperCase()) {
        throw new AppError('KICKFLIP_CURRENCY_MISMATCH', {
          context: { designCurrency: design.currencyCode, storeCurrency },
        });
      }
    }

    let mapping = run.mappingId
      ? await findMappingById(run.mappingId)
      : await findMappingByDesign(run.storeId, run.kickflipDesignId);

    let bigcommerceProductId: number;
    // A previously-orphaned mapping is only recreated when the merchant
    // explicitly requested it (operation === RECREATE_PRODUCT from the UI's
    // dedicated "Recreate product" action) — never as a side effect of a
    // routine re-import.
    const isRecreate = mapping?.status === 'ORPHANED' && run.operation === 'RECREATE_PRODUCT';
    const isNewProduct = !mapping || isRecreate;

    if (mapping && mapping.status === 'ORPHANED' && !isRecreate) {
      throw new AppError('IMPORT_ORPHANED_MAPPING');
    }

    if (mapping && !isRecreate) {
      const existingProduct = await catalogService.getProduct(mapping.bigcommerceProductId);
      if (!existingProduct) {
        await markMappingOrphaned(mapping.id);
        throw new AppError('IMPORT_ORPHANED_MAPPING');
      }

      if (!hadExistingProgress && mapping.sourceFingerprint === design.rawFingerprint) {
        await transitionImportRun(run.id, {
          status: 'SKIPPED',
          currentStage: 'SKIPPED',
          bigcommerceProductId: mapping.bigcommerceProductId,
          finishedAt: new Date(),
        });
        return;
      }

      bigcommerceProductId = mapping.bigcommerceProductId;
      await transitionImportRun(run.id, {
        status: 'UPDATING_PRODUCT',
        currentStage: 'UPDATING_PRODUCT',
        bigcommerceProductId,
      });
      checkAborted(signal);

      const updateInput: UpdateProductInput = {};
      if (options.updateNameOnReimport) updateInput.name = design.name;
      if (options.updatePriceOnReimport) updateInput.price = design.price;
      if (options.updateDescriptionOnReimport)
        updateInput.description = buildProductDescriptionHtml(design);
      if (Object.keys(updateInput).length > 0) {
        await catalogService.updateProduct(bigcommerceProductId, updateInput);
      }
    } else if (run.bigcommerceProductId) {
      // A prior attempt of THIS run already created the product; never create a second one.
      bigcommerceProductId = run.bigcommerceProductId;
    } else {
      await transitionImportRun(run.id, {
        status: 'CREATING_PRODUCT',
        currentStage: 'CREATING_PRODUCT',
      });
      checkAborted(signal);

      const product = await catalogService.createProduct({
        name: design.name,
        price: design.price,
        weight: Number(options.defaultProductWeight),
        sku: generateSku(options.skuPrefix, design.externalId),
        categories: options.defaultCategoryIds,
        isVisible: options.defaultVisibility,
        description: buildProductDescriptionHtml(design),
      });
      bigcommerceProductId = product.id;

      // Persisted immediately — a crash/retry after this point must never
      // create a second product for this design.
      await transitionImportRun(run.id, {
        status: 'CREATING_PRODUCT',
        currentStage: 'CREATING_PRODUCT',
        bigcommerceProductId,
      });
    }

    checkAborted(signal);

    let imageFailures: FailedImage[] = [];
    const shouldProcessImages =
      options.importImages && (isNewProduct || options.updateImagesOnReimport);
    if (shouldProcessImages) {
      await transitionImportRun(run.id, {
        status: 'PROCESSING_IMAGES',
        currentStage: 'PROCESSING_IMAGES',
        bigcommerceProductId,
      });
      const existingImages = await catalogService.listProductImages(bigcommerceProductId);
      const remainingSlots = options.maxImagesPerDesign - existingImages.length;

      if (remainingSlots > 0) {
        const candidateUrls = (
          design.imageUrls.length > 0
            ? design.imageUrls
            : design.primaryImageUrl
              ? [design.primaryImageUrl]
              : []
        ).slice(0, remainingSlots);

        if (candidateUrls.length > 0) {
          const result = await ingestDesignImages({
            catalogService,
            productId: bigcommerceProductId,
            imageUrls: candidateUrls,
            maxImages: remainingSlots,
            correlationId: run.correlationId,
            logger,
            existingImageCount: existingImages.length,
          });
          imageFailures = result.failed;
        }
      }
    }
    checkAborted(signal);

    await transitionImportRun(run.id, {
      status: 'WRITING_METADATA',
      currentStage: 'WRITING_METADATA',
      bigcommerceProductId,
    });
    await catalogService.writeImportMetafields(bigcommerceProductId, {
      design_id: design.externalId,
      product_id: design.productId ?? '',
      customizer_product_id: design.customizerProductId ?? '',
      source_updated_at: design.updatedAt?.toISOString() ?? '',
      source_fingerprint: design.rawFingerprint,
      import_version: '1',
    });

    await transitionImportRun(run.id, { status: 'FINALIZING', currentStage: 'FINALIZING' });

    if (mapping) {
      await updateMappingAfterImport(mapping.id, {
        sourceFingerprint: design.rawFingerprint,
        sourceUpdatedAt: design.updatedAt,
        successful: true,
        bigcommerceProductId: isRecreate ? bigcommerceProductId : undefined,
      });
    } else {
      mapping = await createMapping({
        storeId: run.storeId,
        kickflipDesignId: design.externalId,
        kickflipNumericDesignId: design.numericDesignId,
        kickflipProductId: design.productId,
        kickflipCustomizerProductId: design.customizerProductId,
        bigcommerceProductId,
        sourceFingerprint: design.rawFingerprint,
        sourceUpdatedAt: design.updatedAt,
      });
    }

    const finalStatus: ImportStatus = imageFailures.length > 0 ? 'PARTIAL' : 'SUCCEEDED';
    await transitionImportRun(run.id, {
      status: finalStatus,
      currentStage: finalStatus,
      bigcommerceProductId,
      finishedAt: new Date(),
      safeErrorCode: imageFailures.length > 0 ? 'IMAGE_UPLOAD_FAILED' : null,
      safeErrorMessage:
        imageFailures.length > 0 ? `${imageFailures.length} image(s) failed to upload.` : null,
    });

    await recordAuditEvent({
      storeId: run.storeId,
      storeUserId: run.storeUserId,
      action: 'import.completed',
      entityType: 'import_run',
      entityId: run.id,
      metadata: { status: finalStatus, bigcommerceProductId, mappingId: mapping?.id },
      correlationId: run.correlationId,
    });
  } catch (error) {
    const appError = toAppError(error);
    logger.error(
      { code: appError.code, internalRef: appError.internalRef },
      'Import job attempt failed',
    );
    await transitionImportRun(run.id, {
      status: appError.code === 'IMPORT_CANCELLED' ? 'CANCELLED' : 'FAILED',
      currentStage: 'FAILED',
      safeErrorCode: appError.code,
      safeErrorMessage: appError.message,
      internalErrorRef: appError.internalRef,
      finishedAt: new Date(),
    });
    // Re-throw so pg-boss registers the failure and applies the queue's retry policy.
    throw error;
  }
}
