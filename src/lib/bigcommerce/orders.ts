import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';
import { bcOrderSchema, type BcOrder } from './schemas';

/**
 * BigCommerce Orders API — V2, not V3 (Orders has no V3 equivalent, same
 * reason store-info.ts already calls the V2 `/store` endpoint). Used only by
 * the Orders-sync feature (src/services/order-service.ts); never used by the
 * Kickflip import engine, which never touches order data.
 */

export async function getOrder(client: BigCommerceApiClient, orderId: number): Promise<BcOrder | null> {
  try {
    const result = await client.requestJson<unknown>('GET', `/orders/${orderId}`, { apiVersion: 'v2' });
    const parsed = bcOrderSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
        publicDetail: 'Unexpected response while loading the order.',
      });
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AppError && error.code === 'BIGCOMMERCE_PRODUCT_NOT_FOUND') {
      // mapBigCommerceHttpError maps every 404 to this same code regardless
      // of resource type — see src/lib/bigcommerce/errors.ts.
      return null;
    }
    throw error;
  }
}

export async function listRecentOrders(
  client: BigCommerceApiClient,
  limit: number,
): Promise<BcOrder[]> {
  const result = await client.requestJson<unknown>('GET', '/orders', {
    apiVersion: 'v2',
    query: { sort: 'date_created:desc', limit },
  });

  const parsed = bcOrderSchema.array().safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while loading recent orders.',
    });
  }
  return parsed.data;
}
