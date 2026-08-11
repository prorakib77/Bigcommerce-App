import type { ProductCustomizeConfig, Store } from '@prisma/client';
import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { decryptSecret } from '@/server/crypto/encryption';
import { BigCommerceApiClient } from '@/lib/bigcommerce/client';
import { createModifier } from '@/lib/bigcommerce/modifiers';
import { findStoreById, findStoreByHash } from '@/repositories/store-repository';
import {
  findCustomizeConfig,
  upsertCustomizeConfig,
  updateKickflipModifierId,
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

    // Same fire-and-forget, non-fatal treatment: the cart-add flow degrades
    // gracefully (adds the product without a design reference attached)
    // when this hasn't succeeded yet — see storefront-widget.ts.
    void ensureDesignReferenceModifier(store, config, input.correlationId, input.logger).catch(
      (error: unknown) => {
        input.logger?.warn(
          { err: error, storeId: input.storeId, bigcommerceProductId: input.bigcommerceProductId },
          'Failed to register the Kickflip design reference field',
        );
      },
    );
  }

  return config;
}

/**
 * Registers a hidden-by-default text Modifier on this product to carry the
 * Kickflip designId through checkout onto the order — BigCommerce's
 * Storefront Cart API can only attach custom data to a line item via
 * `option_selections`, which requires a pre-existing Modifier (see
 * docs/api-assumptions.md). Self-healing via a cached id on the
 * ProductCustomizeConfig row (`kickflipModifierId`), same shape as
 * ensureStorefrontScriptRegistered (src/services/storefront-script-service.ts)
 * but keyed per-product rather than per-store.
 *
 * Must never throw in a way that breaks its caller — every call site wraps
 * this in try/catch or fires-and-forgets it, logging a warning only.
 */
export async function ensureDesignReferenceModifier(
  store: Store,
  config: ProductCustomizeConfig,
  correlationId: string,
  logger?: AppLogger,
): Promise<void> {
  const env = getEnv();

  // Same required gate as every other BigCommerce-write self-heal in this
  // app — integration tests run with MOCK_MODE=true and MSW's
  // onUnhandledRequest: 'error'.
  if (env.MOCK_MODE) return;

  if (config.kickflipModifierId) return;
  if (!config.enabled) return;

  const client = new BigCommerceApiClient({
    storeHash: store.storeHash,
    accessToken: decryptSecret(store.encryptedAccessToken),
    correlationId,
    logger,
  });

  const modifier = await createModifier(client, config.bigcommerceProductId, {
    displayName: 'Kickflip design reference',
  });

  if (modifier.id) {
    await updateKickflipModifierId(config.id, modifier.id);
  }
}

export interface PublicCustomizeConfig {
  enabled: boolean;
  customizeUrl: string | null;
  buttonLabel: string;
  /** BigCommerce Modifier option_id, if registered — see ensureDesignReferenceModifier above. */
  modifierId: number | null;
}

const DISABLED_DEFAULT: PublicCustomizeConfig = {
  enabled: false,
  customizeUrl: null,
  buttonLabel: 'Customize',
  modifierId: null,
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

  return {
    enabled: true,
    customizeUrl: config.customizeUrl,
    buttonLabel: config.buttonLabel,
    modifierId: config.kickflipModifierId,
  };
}
