import { AppError } from '@/server/errors/app-error';
import { decryptSecret } from '@/server/crypto/encryption';
import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { createCatalogService, type BigCommerceCatalogService } from '@/lib/bigcommerce/catalog-service';
import type { ListProductsParams, UpdateProductInput } from '@/lib/bigcommerce/catalog';
import type { BcProduct } from '@/lib/bigcommerce/schemas';
import { buildKickflipCustomizerUrl } from '@/lib/kickflip/customizer-url';
import { findStoreById } from '@/repositories/store-repository';
import { findMappingByBigcommerceProduct } from '@/repositories/mapping-repository';
import {
  findCustomizeConfig,
  findCustomizeConfigsByProductIds,
} from '@/repositories/product-customize-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';

async function requireStoreCatalogService(
  storeId: string,
  correlationId: string,
  logger?: AppLogger,
): Promise<{ storeHash: string; catalogService: BigCommerceCatalogService }> {
  const store = await findStoreById(storeId);
  if (!store || !store.isActive) throw new AppError('STORE_INACTIVE');
  const accessToken = decryptSecret(store.encryptedAccessToken);
  return {
    storeHash: store.storeHash,
    catalogService: createCatalogService({
      storeHash: store.storeHash,
      accessToken,
      correlationId,
      logger,
    }),
  };
}

export interface ProductListItem {
  product: BcProduct;
  /** A ProductCustomizeConfig row exists for this product (regardless of its enabled flag). */
  hasCustomizeConfig: boolean;
}

export interface ListProductsForStoreResult {
  items: ProductListItem[];
  currentPage: number;
  totalPages: number;
}

/** Lists every product in the store (not just Kickflip-imported ones), batch-annotated with whether a Customize config exists — mirrors design-service.ts's mapping-batching pattern. */
export async function listProductsForStore(
  storeId: string,
  params: ListProductsParams,
  correlationId: string,
  logger?: AppLogger,
): Promise<ListProductsForStoreResult> {
  const { catalogService } = await requireStoreCatalogService(storeId, correlationId, logger);
  const page = await catalogService.listProducts(params);

  const productIds = page.items.map((product) => product.id);
  const configs = await findCustomizeConfigsByProductIds(storeId, productIds);
  const configuredIds = new Set(configs.map((config) => config.bigcommerceProductId));

  return {
    items: page.items.map((product) => ({
      product,
      hasCustomizeConfig: configuredIds.has(product.id),
    })),
    currentPage: page.currentPage,
    totalPages: page.totalPages,
  };
}

export interface ProductMappingSummary {
  kickflipDesignId: string;
  kickflipCustomizerProductId: string | null;
}

export interface ProductCustomizeSummary {
  enabled: boolean;
  customizeUrl: string | null;
  buttonLabel: string;
}

export interface ProductForEdit {
  product: BcProduct;
  mapping: ProductMappingSummary | null;
  customizeConfig: ProductCustomizeSummary | null;
  /** Derived from KICKFLIP_CUSTOMIZER_BASE_URL + the mapping's Kickflip customizer product id, when both are present. A suggestion only — never overrides a saved value. */
  suggestedCustomizeUrl: string | null;
}

export async function getProductForEdit(
  storeId: string,
  bigcommerceProductId: number,
  correlationId: string,
  logger?: AppLogger,
): Promise<ProductForEdit> {
  const { catalogService } = await requireStoreCatalogService(storeId, correlationId, logger);
  const product = await catalogService.getProduct(bigcommerceProductId);
  if (!product) throw new AppError('BIGCOMMERCE_PRODUCT_NOT_FOUND');

  const [mapping, customizeConfig] = await Promise.all([
    findMappingByBigcommerceProduct(storeId, bigcommerceProductId),
    findCustomizeConfig(storeId, bigcommerceProductId),
  ]);

  const suggestedCustomizeUrl = mapping
    ? buildKickflipCustomizerUrl(
        mapping.kickflipCustomizerProductId,
        getEnv().KICKFLIP_CUSTOMIZER_BASE_URL,
      )
    : null;

  return {
    product,
    mapping: mapping
      ? {
          kickflipDesignId: mapping.kickflipDesignId,
          kickflipCustomizerProductId: mapping.kickflipCustomizerProductId,
        }
      : null,
    customizeConfig: customizeConfig
      ? {
          enabled: customizeConfig.enabled,
          customizeUrl: customizeConfig.customizeUrl,
          buttonLabel: customizeConfig.buttonLabel,
        }
      : null,
    suggestedCustomizeUrl,
  };
}

export async function updateProductBasicFields(
  storeId: string,
  storeUserId: string,
  bigcommerceProductId: number,
  input: UpdateProductInput,
  correlationId: string,
  logger?: AppLogger,
): Promise<BcProduct> {
  const { catalogService } = await requireStoreCatalogService(storeId, correlationId, logger);
  const updated = await catalogService.updateProduct(bigcommerceProductId, input);

  await recordAuditEvent({
    storeId,
    storeUserId,
    action: 'product.updated',
    entityType: 'bigcommerce_product',
    entityId: String(bigcommerceProductId),
    metadata: { fields: Object.keys(input) },
    correlationId,
  });

  return updated;
}
