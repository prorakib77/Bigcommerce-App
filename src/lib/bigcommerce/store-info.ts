import { z } from 'zod';
import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';

const v2StoreSchema = z.object({ currency: z.string().length(3) }).loose();

/**
 * BigCommerce's store-level currency setting. Uses the legacy but stable
 * and still-documented V2 `/store` resource — V3 has no dedicated store
 * settings endpoint with this field. Called at most once per import run;
 * not persisted, since a merchant could change store currency at any time.
 */
export async function getStoreCurrencyCode(client: BigCommerceApiClient): Promise<string> {
  const result = await client.requestJson<unknown>('GET', '/store', { apiVersion: 'v2' });
  const parsed = v2StoreSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Could not determine the store currency.',
    });
  }
  return parsed.data.currency.toUpperCase();
}
