import type { ProductCustomizeConfig } from '@prisma/client';
import type { AppLogger } from '@/server/logging/logger';
import { findStoreById, findStoreByHash } from '@/repositories/store-repository';
import {
  findCustomizeConfig,
  upsertCustomizeConfig,
} from '@/repositories/product-customize-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';
import { ensureStorefrontScriptRegistered } from './storefront-script-service';

export interface SaveProductCustomizeConfigInput {
  storeId: string;
  storeUserId: string;
  bigcommerceProductId: number;
  enabled: boolean;
  customizeUrl: string | null;
  buttonLabel: string;
  correlationId: string;
  logger?: AppLogger;
}

export async function saveProductCustomizeConfig(
  input: SaveProductCustomizeConfigInput,
): Promise<ProductCustomizeConfig> {
  const config = await upsertCustomizeConfig({
    storeId: input.storeId,
    bigcommerceProductId: input.bigcommerceProductId,
    enabled: input.enabled,
    customizeUrl: input.customizeUrl,
    buttonLabel: input.buttonLabel,
  });

  await recordAuditEvent({
    storeId: input.storeId,
    storeUserId: input.storeUserId,
    action: 'product_customize_config.saved',
    entityType: 'product_customize_config',
    entityId: String(input.bigcommerceProductId),
    metadata: { enabled: input.enabled },
    correlationId: input.correlationId,
  });

  // Best-effort, fire-and-forget: this is the recovery path if install-time
  // script registration failed — the widget won't appear on any product
  // until either install succeeds or this succeeds once. Must never fail
  // the save itself.
  const store = await findStoreById(input.storeId);
  if (store) {
    void ensureStorefrontScriptRegistered(store, input.correlationId, input.logger).catch(
      (error: unknown) => {
        input.logger?.warn(
          { err: error, storeId: input.storeId },
          'Failed to register the storefront Customize widget script',
        );
      },
    );
  }

  return config;
}

export interface PublicCustomizeConfig {
  enabled: boolean;
  customizeUrl: string | null;
  buttonLabel: string;
}

const DISABLED_DEFAULT: PublicCustomizeConfig = {
  enabled: false,
  customizeUrl: null,
  buttonLabel: 'Customize',
};

/**
 * Public (unauthenticated, storefront-facing) lookup. Always resolves —
 * never throws — collapsing "store not found/inactive" and "no config
 * saved" into the same disabled default so the widget script's branching
 * stays trivial and no product-id enumeration signal leaks to an anonymous
 * caller.
 */
export async function getPublicCustomizeConfig(
  storeHash: string,
  bigcommerceProductId: number,
): Promise<PublicCustomizeConfig> {
  const store = await findStoreByHash(storeHash);
  if (!store || !store.isActive) return DISABLED_DEFAULT;

  const config = await findCustomizeConfig(store.id, bigcommerceProductId);
  if (!config || !config.enabled || !config.customizeUrl) return DISABLED_DEFAULT;

  return { enabled: true, customizeUrl: config.customizeUrl, buttonLabel: config.buttonLabel };
}
