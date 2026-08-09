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

export type ConsentCategory = 'essential' | 'functional' | 'analytics' | 'targeting';

export interface CreateScriptInput {
  name: string;
  src: string;
  loadMethod?: 'default' | 'async' | 'defer';
  location?: 'head' | 'footer';
  visibility?: 'storefront' | 'checkout' | 'order_confirmation' | 'all_pages';
  consentCategory?: ConsentCategory;
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
      consent_category: input.consentCategory,
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

/**
 * Consent category defaults to 'unknown' on BigCommerce's side when never
 * set, and a script left at 'unknown' is silently not displayed at all on
 * any storefront with a customer cookie-consent banner enabled — confirmed
 * against live BigCommerce API docs. Used by the self-heal path to backfill
 * this for scripts registered before this field was set on create.
 *
 * Resends the full set of fields (not just consent_category) — BigCommerce's
 * PUT semantics for this endpoint aren't documented clearly enough to trust
 * a partial body wouldn't reset omitted fields to defaults.
 */
export async function updateScript(
  client: BigCommerceApiClient,
  uuid: string,
  input: CreateScriptInput,
): Promise<void> {
  await client.requestJson<unknown>('PUT', `/content/scripts/${encodeURIComponent(uuid)}`, {
    body: {
      name: input.name,
      src: input.src,
      kind: 'src',
      load_method: input.loadMethod ?? 'default',
      location: input.location ?? 'footer',
      visibility: input.visibility ?? 'storefront',
      auto_uninstall: true,
      consent_category: input.consentCategory,
    },
  });
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
