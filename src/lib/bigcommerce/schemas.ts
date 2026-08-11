import { z } from 'zod';

/** `context` / `sub` claims look like "stores/abc123xyz". */
export const STORE_CONTEXT_PATTERN = /^stores\/([a-zA-Z0-9]+)$/;

export function storeHashFromContext(context: string): string | null {
  const match = STORE_CONTEXT_PATTERN.exec(context);
  return match?.[1] ?? null;
}

/** Query parameters BigCommerce appends to the auth (install) callback URL. */
export const authCallbackQuerySchema = z.object({
  code: z.string().min(1),
  scope: z.string().min(1),
  context: z.string().regex(STORE_CONTEXT_PATTERN, 'context must look like "stores/{hash}"'),
  account_uuid: z.string().optional(),
});
export type AuthCallbackQuery = z.infer<typeof authCallbackQuerySchema>;

/** Response body from POST https://login.bigcommerce.com/oauth2/token */
export const bcTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  scope: z.string().min(1),
  user: z.object({
    id: z.number().int(),
    email: z.email(),
  }),
  context: z.string().regex(STORE_CONTEXT_PATTERN),
  account_uuid: z.string().optional(),
});
export type BcTokenResponse = z.infer<typeof bcTokenResponseSchema>;

/**
 * Shared claim shape for the `signed_payload_jwt` BigCommerce sends to the
 * load, uninstall, and remove-user callbacks. `user` is the subject of the
 * event (the person loading the app, or the user who was removed); `owner`
 * always identifies the store owner, letting us distinguish OWNER vs USER
 * without a separate lookup.
 */
export const bcCallbackJwtPayloadSchema = z.object({
  iss: z.string().min(1),
  iat: z.number(),
  nbf: z.number().optional(),
  exp: z.number(),
  jti: z.string().min(1),
  sub: z.string().regex(STORE_CONTEXT_PATTERN),
  aud: z.string().min(1),
  context: z.string().regex(STORE_CONTEXT_PATTERN).optional(),
  account_uuid: z.string().optional(),
  user: z.object({
    id: z.number().int(),
    email: z.email(),
    locale: z.string().optional(),
  }),
  owner: z.object({
    id: z.number().int(),
    email: z.email(),
  }),
});
export type BcCallbackJwtPayload = z.infer<typeof bcCallbackJwtPayloadSchema>;

// ---------------------------------------------------------------------------
// V3 Catalog API
// ---------------------------------------------------------------------------

export function bcListResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    meta: z
      .object({
        pagination: z
          .object({
            total: z.number().optional(),
            count: z.number().optional(),
            per_page: z.number().optional(),
            current_page: z.number().optional(),
            total_pages: z.number().optional(),
          })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
  });
}

export function bcSingleResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({ data: itemSchema, meta: z.looseObject({}).optional() });
}

export const bcCategorySchema = z
  .object({
    id: z.number(),
    parent_id: z.number(),
    name: z.string(),
    is_visible: z.boolean().optional(),
  })
  .loose();
export type BcCategory = z.infer<typeof bcCategorySchema>;

export const bcProductImageSchema = z
  .object({
    id: z.number(),
    product_id: z.number(),
    is_thumbnail: z.boolean().optional(),
    sort_order: z.number().optional(),
    image_url: z.string().optional(),
  })
  .loose();
export type BcProductImage = z.infer<typeof bcProductImageSchema>;

export const bcProductSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    sku: z.string().optional(),
    price: z.union([z.number(), z.string()]).optional(),
    description: z.string().optional(),
    is_visible: z.boolean().optional(),
    categories: z.array(z.number()).optional(),
    // Only present when the request used `include=images` (see
    // src/lib/bigcommerce/catalog.ts's listProducts).
    images: z.array(bcProductImageSchema).optional(),
  })
  .loose();
export type BcProduct = z.infer<typeof bcProductSchema>;

export const bcMetafieldSchema = z
  .object({
    id: z.number().optional(),
    key: z.string(),
    value: z.string(),
    namespace: z.string(),
    permission_set: z.string().optional(),
    resource_type: z.string().optional(),
    resource_id: z.number().optional(),
  })
  .loose();
export type BcMetafield = z.infer<typeof bcMetafieldSchema>;

// ---------------------------------------------------------------------------
// Content / Script Manager API (src/lib/bigcommerce/scripts.ts)
//
// FLAG: every field/enum value here is an unverified assumption about
// BigCommerce's `/content/scripts` V3 shape, not confirmed against live docs
// this session — same treatment docs/api-assumptions.md gives Kickflip's
// assumed shapes. Fix here first if the real API differs.
// ---------------------------------------------------------------------------

export const bcScriptSchema = z
  .object({
    uuid: z.string().optional(),
    name: z.string(),
    src: z.string().optional(),
    load_method: z.enum(['default', 'async', 'defer']).optional(),
    location: z.enum(['head', 'footer']).optional(),
    visibility: z.enum(['storefront', 'checkout', 'order_confirmation', 'all_pages']).optional(),
    kind: z.enum(['src', 'script_tag']).optional(),
    // Confirmed against live BigCommerce API docs (unlike the rest of this
    // schema): defaults to 'unknown' when omitted, and BigCommerce silently
    // does not display a script at all on any storefront with a customer
    // cookie-consent banner enabled (e.g. Catalyst/c15t storefronts) unless
    // this is set to a real category.
    consent_category: z.enum(['essential', 'functional', 'analytics', 'targeting']).optional(),
  })
  .loose();
export type BcScript = z.infer<typeof bcScriptSchema>;

// ---------------------------------------------------------------------------
// Orders V2 API (src/lib/bigcommerce/orders.ts)
//
// V2 (not V3) — BigCommerce's Orders API has no V3 equivalent, same reason
// src/lib/bigcommerce/store-info.ts already calls the V2 `/store` endpoint.
// `total_inc_tax` is deliberately typed as a string, not coerced to a
// number: BigCommerce's V2 API already returns it as a decimal string, and
// this app's convention (see catalog.ts's decimalStringToNumber comment) is
// to keep prices as strings end-to-end and never touch them as JS floats.
// ---------------------------------------------------------------------------

export const bcOrderSchema = z
  .object({
    id: z.number(),
    status: z.string(),
    status_id: z.number().optional(),
    total_inc_tax: z.string(),
    currency_code: z.string().optional(),
    items_total: z.number().optional(),
    date_created: z.string().optional(),
    billing_address: z
      .object({
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        email: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
export type BcOrder = z.infer<typeof bcOrderSchema>;

// ---------------------------------------------------------------------------
// Webhooks V3 API (src/lib/bigcommerce/webhooks.ts)
//
// FLAG: every field/enum value here is an unverified assumption about
// BigCommerce's `/hooks` V3 shape, not confirmed against live docs this
// session — same treatment as bcScriptSchema above. In particular: this app
// assumes BigCommerce webhook deliveries carry no cryptographic signature
// and that the `headers` object set here is BigCommerce's actual supported
// mechanism for verifying delivery authenticity (a shared secret header,
// not HMAC). See docs/api-assumptions.md for the full writeup and the
// "prefer HMAC once confirmed" follow-up note.
// ---------------------------------------------------------------------------

export const bcHookSchema = z
  .object({
    id: z.number().optional(),
    scope: z.string(),
    destination: z.string(),
    is_active: z.boolean().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .loose();
export type BcHook = z.infer<typeof bcHookSchema>;

// ---------------------------------------------------------------------------
// Product Modifiers API (src/lib/bigcommerce/modifiers.ts)
//
// FLAG: every field/enum value here is an unverified assumption about
// BigCommerce's `/catalog/products/{id}/modifiers` V3 shape, not confirmed
// against live docs this session — same treatment as bcScriptSchema/
// bcHookSchema above. See docs/api-assumptions.md for the full writeup.
// ---------------------------------------------------------------------------

export const bcModifierSchema = z
  .object({
    id: z.number().optional(),
    product_id: z.number().optional(),
    name: z.string().optional(),
    display_name: z.string(),
    type: z.string(),
    required: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type BcModifier = z.infer<typeof bcModifierSchema>;
