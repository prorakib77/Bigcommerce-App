import { z } from 'zod';
import { publicRoute, jsonOk } from '@/server/http/handler';
import { readJsonBody } from '@/server/http/body';
import { AppError } from '@/server/errors/app-error';
import { assertWithinRateLimit } from '@/server/rate-limit';
import { getEnv } from '@/server/env';
import { timingSafeEqualStrings } from '@/server/crypto/hash';
import { findStoreByHash } from '@/repositories/store-repository';
import { syncOrderFromWebhook } from '@/services/order-service';
import { ORDERS_WEBHOOK_SECRET_HEADER } from '@/services/orders-webhook-service';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  // Matches STORE_CONTEXT_PATTERN's captured group in src/lib/bigcommerce/schemas.ts.
  storeHash: z.string().regex(/^[a-zA-Z0-9]+$/),
});

const webhookBodySchema = z.object({
  data: z.object({
    type: z.string(),
    id: z.number(),
  }),
});

/**
 * Public, unauthenticated: BigCommerce calls this server-to-server on every
 * order-created event, no bearer session is possible. Authenticity is a
 * shared secret header (not a bearer token / not HMAC — see
 * src/services/orders-webhook-service.ts and docs/api-assumptions.md),
 * verified in constant time. Never trusts the webhook body as authoritative
 * — always re-fetches the order from BigCommerce's own API before writing
 * anything (see src/services/order-service.ts::syncOrderFromWebhook).
 */
export const POST = publicRoute(async (request, ctx) => {
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({ storeHash: url.searchParams.get('storeHash') });
  if (!parsedQuery.success) throw new AppError('VALIDATION_FAILED');
  const { storeHash } = parsedQuery.data;

  const env = getEnv();
  assertWithinRateLimit(
    `orders-webhook:${storeHash}`,
    env.RATE_LIMIT_WEBHOOK_WINDOW_MS,
    env.RATE_LIMIT_WEBHOOK_MAX,
  );

  const store = await findStoreByHash(storeHash);
  if (!store || !store.isActive) {
    // Unknown/inactive store: benign no-op, matching the remove-user/uninstall
    // callbacks' existing convention — never differentiate "store doesn't
    // exist" via a distinguishing status code.
    return jsonOk({ received: true }, ctx.requestId);
  }

  const providedSecret = request.headers.get(ORDERS_WEBHOOK_SECRET_HEADER);
  if (!timingSafeEqualStrings(providedSecret, store.ordersWebhookSecret)) {
    throw new AppError('UNAUTHENTICATED');
  }

  const parsedBody = webhookBodySchema.safeParse(await readJsonBody(request));
  if (!parsedBody.success || parsedBody.data.data.type !== 'order') {
    ctx.logger.warn({ storeHash }, 'Orders webhook received a malformed or unexpected payload');
    throw new AppError('VALIDATION_FAILED');
  }

  // Any real failure here (e.g. a transient BigCommerce API error) is
  // deliberately allowed to surface as a 5xx — BigCommerce's own
  // webhook-delivery system retries failed deliveries with its own backoff,
  // reused here instead of a custom retry/queue path.
  await syncOrderFromWebhook(storeHash, parsedBody.data.data.id, ctx.correlationId, ctx.logger);

  return jsonOk({ received: true }, ctx.requestId);
});
