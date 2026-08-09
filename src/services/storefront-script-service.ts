import type { Store } from '@prisma/client';
import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { decryptSecret } from '@/server/crypto/encryption';
import { BigCommerceApiClient } from '@/lib/bigcommerce/client';
import { createScript, updateScript, type CreateScriptInput } from '@/lib/bigcommerce/scripts';
import { updateStorefrontScriptRegistration } from '@/repositories/store-repository';

/**
 * Registers the storefront Customize-button widget script
 * (src/lib/bigcommerce/storefront-widget.ts) with BigCommerce Script
 * Manager, once per store. Self-healing via a cached uuid on the Store row
 * (`storefrontScriptUuid`) — no reconciliation job re-verifies the script
 * still exists on BigCommerce's side if a merchant manually deletes it; a
 * deliberate scope cut, see docs/api-assumptions.md.
 *
 * Must never throw in a way that breaks its caller — every call site either
 * wraps this in try/catch or fires-and-forgets it, logging a warning only.
 */
export async function ensureStorefrontScriptRegistered(
  store: Store,
  correlationId: string,
  logger?: AppLogger,
): Promise<void> {
  const env = getEnv();

  // Required, not optional: integration tests run with MOCK_MODE=true and
  // MSW's onUnhandledRequest: 'error' — skipping this gate breaks every
  // currently-passing install test the moment this makes a real network call.
  if (env.MOCK_MODE) return;

  const client = new BigCommerceApiClient({
    storeHash: store.storeHash,
    accessToken: decryptSecret(store.encryptedAccessToken),
    correlationId,
    logger,
  });

  const src = `${env.APP_BASE_URL}/api/public/storefront/widget?storeHash=${encodeURIComponent(store.storeHash)}`;

  const scriptInput: CreateScriptInput = {
    // Plain ASCII only: BigCommerce's Scripts API rejects the em-dash
    // previously used here with a 422 "Script name contains invalid
    // characters" — confirmed in production logs, silently blocking every
    // install and every self-heal retry from ever succeeding.
    name: 'Kickflip Import - Customize button',
    src,
    loadMethod: 'default',
    location: 'footer',
    visibility: 'storefront',
    // Confirmed against live BigCommerce API docs: a script left at the
    // 'unknown' default consent category is silently not displayed at all
    // on any storefront with a customer cookie-consent banner enabled
    // (e.g. Catalyst/c15t storefronts) — this isn't marketing/analytics, it
    // just adds a merchant-configured storefront feature, so 'functional'
    // fits best.
    consentCategory: 'functional',
  };

  if (store.storefrontScriptUuid) {
    // Backfills the consent category on scripts registered before this
    // field existed here — cheap and idempotent, so it's fine to repeat on
    // every call rather than tracking a separate "already backfilled" flag.
    await updateScript(client, store.storefrontScriptUuid, scriptInput);
    return;
  }

  const script = await createScript(client, scriptInput);

  if (script.uuid) {
    await updateStorefrontScriptRegistration(store.id, script.uuid);
  }
}
