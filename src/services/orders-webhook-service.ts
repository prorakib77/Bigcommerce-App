import { randomBytes } from 'node:crypto';
import type { Store } from '@prisma/client';
import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { decryptSecret } from '@/server/crypto/encryption';
import { BigCommerceApiClient } from '@/lib/bigcommerce/client';
import { createHook } from '@/lib/bigcommerce/webhooks';
import { updateOrdersWebhookRegistration } from '@/repositories/store-repository';

/** Shared between registration (here) and verification (the webhook receiver route) so the header name can't drift out of sync. */
export const ORDERS_WEBHOOK_SECRET_HEADER = 'x-kickflip-webhook-secret';

/**
 * Registers the Orders webhook with BigCommerce, once per store. Self-heals
 * via a cached id on the Store row — same pattern as
 * storefront-script-service.ts::ensureStorefrontScriptRegistered.
 *
 * Unlike that function, this one does NOT hard-skip everything under
 * MOCK_MODE: the secret generated here is the entire authentication
 * mechanism for a public endpoint
 * (src/app/api/public/webhooks/bigcommerce/orders), so it must exist under
 * MOCK_MODE too (integration tests run with MOCK_MODE=true) for that
 * endpoint's success path to ever be testable. Only the real outbound
 * BigCommerce network call is skipped under MOCK_MODE, not the local secret
 * generation and persistence.
 *
 * Must never throw in a way that breaks its caller — every call site either
 * wraps this in try/catch or fires-and-forgets it, logging a warning only.
 */
export async function ensureOrdersWebhookRegistered(
  store: Store,
  correlationId: string,
  logger?: AppLogger,
): Promise<void> {
  if (store.ordersWebhookId !== null) return;

  const env = getEnv();
  const secret = randomBytes(32).toString('hex');

  let webhookId: number;
  if (env.MOCK_MODE) {
    webhookId = -1;
  } else {
    const client = new BigCommerceApiClient({
      storeHash: store.storeHash,
      accessToken: decryptSecret(store.encryptedAccessToken),
      correlationId,
      logger,
    });
    const destination = `${env.APP_BASE_URL}/api/public/webhooks/bigcommerce/orders?storeHash=${encodeURIComponent(store.storeHash)}`;
    const hook = await createHook(client, {
      scope: 'store/order/created',
      destination,
      headers: { [ORDERS_WEBHOOK_SECRET_HEADER]: secret },
    });
    webhookId = hook.id ?? -1;
  }

  await updateOrdersWebhookRegistration(store.id, { webhookId, secret });
}
