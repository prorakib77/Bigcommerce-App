import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';
import { bcHookSchema, bcListResponseSchema, bcSingleResponseSchema, type BcHook } from './schemas';

/**
 * BigCommerce Webhooks V3 API (`/hooks`), used only to register the Orders
 * webhook (src/services/orders-webhook-service.ts). Kept separate from
 * BigCommerceCatalogService for the same reason scripts.ts is — an
 * install-time/config-time concern with no meaningful mock storefront to
 * register anything against.
 *
 * FLAG: field names and the exact path are an unverified assumption — see
 * docs/api-assumptions.md.
 */

const hookResponseSchema = bcSingleResponseSchema(bcHookSchema);
const hooksListResponseSchema = bcListResponseSchema(bcHookSchema);

export interface CreateHookInput {
  scope: string;
  destination: string;
  headers?: Record<string, string>;
}

export async function createHook(client: BigCommerceApiClient, input: CreateHookInput): Promise<BcHook> {
  const result = await client.requestJson<unknown>('POST', '/hooks', {
    body: {
      scope: input.scope,
      destination: input.destination,
      is_active: true,
      headers: input.headers,
    },
  });

  const parsed = hookResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while registering the orders webhook.',
    });
  }
  return parsed.data.data;
}

export async function listHooks(client: BigCommerceApiClient): Promise<BcHook[]> {
  const result = await client.requestJson<unknown>('GET', '/hooks', { query: { limit: 250 } });

  const parsed = hooksListResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while listing webhooks.',
    });
  }
  return parsed.data.data;
}
