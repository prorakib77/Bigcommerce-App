import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';
import {
  bcListResponseSchema,
  bcMetafieldSchema,
  bcSingleResponseSchema,
  type BcMetafield,
} from './schemas';

export const METAFIELD_NAMESPACE = 'kickflip_import';

const metafieldResponseSchema = bcSingleResponseSchema(bcMetafieldSchema);
const metafieldsListResponseSchema = bcListResponseSchema(bcMetafieldSchema);

/**
 * Private, app-owned product metadata (namespace `kickflip_import`,
 * permission_set `app_only`) used for recovery/traceability. The relational
 * database (`ImportMapping`) remains the source of truth — these metafields
 * are never read by the storefront.
 */
export async function listAppMetafields(
  client: BigCommerceApiClient,
  productId: number,
): Promise<BcMetafield[]> {
  const result = await client.requestJson<unknown>(
    'GET',
    `/catalog/products/${productId}/metafields`,
    {
      query: { namespace: METAFIELD_NAMESPACE },
    },
  );
  const parsed = metafieldsListResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while loading product metadata.',
    });
  }
  return parsed.data.data;
}

export async function upsertAppMetafield(
  client: BigCommerceApiClient,
  productId: number,
  key: string,
  value: string,
): Promise<BcMetafield> {
  const existing = await listAppMetafields(client, productId);
  const match = existing.find((m) => m.key === key);

  const path = match
    ? `/catalog/products/${productId}/metafields/${match.id}`
    : `/catalog/products/${productId}/metafields`;
  const method = match ? 'PUT' : 'POST';

  const result = await client.requestJson<unknown>(method, path, {
    body: {
      key,
      value,
      namespace: METAFIELD_NAMESPACE,
      permission_set: 'app_only',
    },
  });

  const parsed = metafieldResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while writing product metadata.',
    });
  }
  return parsed.data.data;
}

export interface ImportMetafieldValues {
  design_id: string;
  product_id: string;
  customizer_product_id: string;
  source_updated_at: string;
  source_fingerprint: string;
  import_version: string;
}

export async function writeImportMetafields(
  client: BigCommerceApiClient,
  productId: number,
  values: ImportMetafieldValues,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await upsertAppMetafield(client, productId, key, value);
  }
}
