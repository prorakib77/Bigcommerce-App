import { z } from 'zod';
import { readJsonBody } from '@/server/http/body';
import { publicRoute, jsonOk } from '@/server/http/handler';
import { withCorsHeaders } from '@/server/http/cors';
import { AppError } from '@/server/errors/app-error';
import { assertWithinRateLimit } from '@/server/rate-limit';
import { getClientIp } from '@/server/http/client-ip';
import { getEnv } from '@/server/env';
import { addPricedKickflipCartItem } from '@/services/storefront-priced-cart-service';

export const dynamic = 'force-dynamic';

const optionSelectionSchema = z.object({
  optionId: z.number().int().positive(),
  optionValue: z.union([z.string().max(1000), z.number().int()]),
});

const bodySchema = z.object({
  storeHash: z.string().regex(/^[a-zA-Z0-9]+$/),
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  cartId: z.uuid().nullable().optional(),
  quantity: z.number().int().positive().max(999),
  kickflipPriceAdjustment: z.union([
    z.number().finite(),
    z
      .string()
      .trim()
      .regex(/^-?\d+(\.\d{1,4})?$/),
  ]),
  optionSelections: z.array(optionSelectionSchema).max(100).default([]),
});

const corsOptions = {
  methods: 'POST, OPTIONS',
  headers: 'Content-Type, X-Request-Id',
};

const handler = publicRoute(async (request, ctx) => {
  const env = getEnv();
  assertWithinRateLimit(
    `storefront-priced-cart:${getClientIp(request)}`,
    env.RATE_LIMIT_STOREFRONT_WINDOW_MS,
    env.RATE_LIMIT_STOREFRONT_MAX,
  );

  const parsed = bodySchema.safeParse(await readJsonBody(request, 64 * 1024));
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const result = await addPricedKickflipCartItem({
    storeHash: parsed.data.storeHash,
    bigcommerceProductId: parsed.data.productId,
    variantId: parsed.data.variantId,
    cartId: parsed.data.cartId,
    quantity: parsed.data.quantity,
    kickflipPriceAdjustment: parsed.data.kickflipPriceAdjustment,
    optionSelections: parsed.data.optionSelections,
    correlationId: ctx.correlationId,
    logger: ctx.logger,
  });

  return jsonOk(result, ctx.requestId);
});

export async function OPTIONS(): Promise<Response> {
  return withCorsHeaders(new Response(null, { status: 204 }), corsOptions);
}

export async function POST(request: Request): Promise<Response> {
  return withCorsHeaders(await handler(request), corsOptions);
}
