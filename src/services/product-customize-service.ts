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
  updateKickflipSummaryModifierId,
} from '@/repositories/product-customize-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';
import { ensureStorefrontScriptRegistered } from './storefront-script-service';

const DESIGN_REFERENCE_MODIFIER_DISPLAY_NAME = 'Kickflip design reference';
const CUSTOMIZATION_SUMMARY_MODIFIER_DISPLAY_NAME = 'Kickflip selected options';
const CUSTOMIZATION_SUMMARY_TEXT_MAX_LENGTH = 1000;

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
    // gracefully (adds the product without Kickflip metadata attached) when
    // this hasn't succeeded yet — see storefront-widget.ts.
    void ensureKickflipCartModifiers(store, config, input.correlationId, input.logger).catch(
      (error: unknown) => {
        input.logger?.warn(
          { err: error, storeId: input.storeId, bigcommerceProductId: input.bigcommerceProductId },
          'Failed to register the Kickflip cart modifier fields',
        );
      },
    );
  }

  return config;
}

/**
 * Registers the BigCommerce text Modifiers this storefront cart bridge needs:
 * a hidden design-reference field and a hidden-on-product, shopper-readable
 * selected-options summary field. BigCommerce's Storefront Cart API can only
 * attach custom data to a line item via `option_selections`, which requires a
 * pre-existing Modifier (see docs/api-assumptions.md). Self-healing via cached
 * ids on the ProductCustomizeConfig row, same shape as
 * ensureStorefrontScriptRegistered (src/services/storefront-script-service.ts)
 * but keyed per-product rather than per-store.
 *
 * Must never throw in a way that breaks its caller — every call site wraps
 * this in try/catch or fires-and-forgets it, logging a warning only.
 */
export async function ensureKickflipCartModifiers(
  store: Store,
  config: ProductCustomizeConfig,
  correlationId: string,
  logger?: AppLogger,
): Promise<ProductCustomizeConfig> {
  const env = getEnv();

  // Same required gate as every other BigCommerce-write self-heal in this
  // app — integration tests run with MOCK_MODE=true and MSW's
  // onUnhandledRequest: 'error'.
  if (env.MOCK_MODE) return config;

  if (!config.enabled) return config;
  if (config.kickflipModifierId && config.kickflipSummaryModifierId) return config;

  const client = new BigCommerceApiClient({
    storeHash: store.storeHash,
    accessToken: decryptSecret(store.encryptedAccessToken),
    correlationId,
    logger,
  });

  let currentConfig = config;

  if (!currentConfig.kickflipModifierId) {
    const modifier = await createModifier(client, currentConfig.bigcommerceProductId, {
      displayName: DESIGN_REFERENCE_MODIFIER_DISPLAY_NAME,
    });

    if (modifier.id) {
      await updateKickflipModifierId(currentConfig.id, modifier.id);
      currentConfig = { ...currentConfig, kickflipModifierId: modifier.id };
    }
  }

  if (!currentConfig.kickflipSummaryModifierId) {
    const modifier = await createModifier(client, currentConfig.bigcommerceProductId, {
      displayName: CUSTOMIZATION_SUMMARY_MODIFIER_DISPLAY_NAME,
      type: 'multi_line_text',
      textMaxLength: CUSTOMIZATION_SUMMARY_TEXT_MAX_LENGTH,
    });

    if (modifier.id) {
      await updateKickflipSummaryModifierId(currentConfig.id, modifier.id);
      currentConfig = { ...currentConfig, kickflipSummaryModifierId: modifier.id };
    }
  }

  return currentConfig;
}

export async function ensureDesignReferenceModifier(
  store: Store,
  config: ProductCustomizeConfig,
  correlationId: string,
  logger?: AppLogger,
): Promise<void> {
  await ensureKickflipCartModifiers(store, config, correlationId, logger);
}

export interface PublicCustomizeConfig {
  enabled: boolean;
  customizeUrl: string | null;
  buttonLabel: string;
  /** BigCommerce Modifier option_id, if registered — see ensureDesignReferenceModifier above. */
  modifierId: number | null;
  /** BigCommerce Modifier option_id for the shopper-readable Kickflip option summary. */
  summaryModifierId: number | null;
}

const DISABLED_DEFAULT: PublicCustomizeConfig = {
  enabled: false,
  customizeUrl: null,
  buttonLabel: 'Customize',
  modifierId: null,
  summaryModifierId: null,
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

  let activeConfig = config;
  if (!activeConfig.kickflipModifierId || !activeConfig.kickflipSummaryModifierId) {
    try {
      activeConfig = await ensureKickflipCartModifiers(
        store,
        activeConfig,
        `storefront-config:${storeHash}:${bigcommerceProductId}`,
      );
    } catch {
      // Public storefront lookups must stay no-throw. If BigCommerce modifier
      // creation fails, the widget still renders and adds to cart without the
      // missing metadata until the next successful self-heal.
    }
  }

  return {
    enabled: true,
    customizeUrl: activeConfig.customizeUrl,
    buttonLabel: activeConfig.buttonLabel,
    modifierId: activeConfig.kickflipModifierId,
    summaryModifierId: activeConfig.kickflipSummaryModifierId,
  };
}
