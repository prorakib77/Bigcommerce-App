import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';
import { bcListResponseSchema, bcScriptSchema, bcSingleResponseSchema, type BcScript } from './schemas';

/**
 * BigCommerce Content/Script Manager API (`/content/scripts`), used only to
 * register the storefront Customize-button widget at install time
 * (src/services/storefront-script-service.ts). Kept separate from
 * catalog-service.ts's BigCommerceCatalogService — that interface exists for
 * the import engine's mock-testability; there's no meaningful "mock
 * storefront" to register a script against, so this stays its own adapter.
 *
 * FLAG: field names/values are an unverified assumption about the real API
 * shape — see docs/api-assumptions.md and bcScriptSchema's own note.
 */

const scriptResponseSchema = bcSingleResponseSchema(bcScriptSchema);
const scriptsListResponseSchema = bcListResponseSchema(bcScriptSchema);

export interface CreateScriptInput {
  name: string;
  src: string;
  loadMethod?: 'default' | 'async' | 'defer';
  location?: 'head' | 'footer';
  visibility?: 'storefront' | 'checkout' | 'order_confirmation' | 'all_pages';
}

export async function createScript(
  client: BigCommerceApiClient,
  input: CreateScriptInput,
): Promise<BcScript> {
  const result = await client.requestJson<unknown>('POST', '/content/scripts', {
    body: {
      name: input.name,
      src: input.src,
      kind: 'src',
      load_method: input.loadMethod ?? 'default',
      location: input.location ?? 'footer',
      visibility: input.visibility ?? 'storefront',
      auto_uninstall: true,
    },
  });

  const parsed = scriptResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while registering the storefront script.',
    });
  }
  return parsed.data.data;
}

export async function listScripts(client: BigCommerceApiClient): Promise<BcScript[]> {
  const result = await client.requestJson<unknown>('GET', '/content/scripts', {
    query: { limit: 250 },
  });

  const parsed = scriptsListResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while listing storefront scripts.',
    });
  }
  return parsed.data.data;
}
