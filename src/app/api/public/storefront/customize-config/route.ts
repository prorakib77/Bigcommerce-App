import { z } from 'zod';
import { publicRoute, jsonOk } from '@/server/http/handler';
import { AppError } from '@/server/errors/app-error';
import { assertWithinRateLimit } from '@/server/rate-limit';
import { getClientIp } from '@/server/http/client-ip';
import { getEnv } from '@/server/env';
import { withCorsHeaders } from '@/server/http/cors';
import { getPublicCustomizeConfig } from '@/services/product-customize-service';

export const dynamic = 'force-dynamic';

// Matches STORE_CONTEXT_PATTERN's captured group in src/lib/bigcommerce/schemas.ts.
const querySchema = z.object({
  storeHash: z.string().regex(/^[a-zA-Z0-9]+$/),
  productId: z.coerce.number().int().positive(),
});

/**
 * Public, unauthenticated: fetched cross-origin by the storefront widget
 * script (src/lib/bigcommerce/storefront-widget.ts) on ordinary product-page
 * views. Always resolves 200, never 404/500, so an anonymous caller can't
 * use this to enumerate which product ids exist in a store — see
 * src/services/product-customize-service.ts::getPublicCustomizeConfig.
 */
const handler = publicRoute(async (request, ctx) => {
  const env = getEnv();
  assertWithinRateLimit(
    `storefront-config:${getClientIp(request)}`,
    env.RATE_LIMIT_STOREFRONT_WINDOW_MS,
    env.RATE_LIMIT_STOREFRONT_MAX,
  );

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    storeHash: url.searchParams.get('storeHash'),
    productId: url.searchParams.get('productId'),
  });
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const config = await getPublicCustomizeConfig(parsed.data.storeHash, parsed.data.productId);
  return jsonOk(config, ctx.requestId);
});

export async function GET(request: Request): Promise<Response> {
  const response = withCorsHeaders(await handler(request));
  // Deliberate, called-out exception to this app's otherwise universal
  // `no-store` convention (see src/server/http/response.ts) — this payload
  // is small, non-personalized, and hit on every storefront product view.
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=30');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
