import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';
import { bcModifierSchema, bcSingleResponseSchema, type BcModifier } from './schemas';

/**
 * BigCommerce Product Modifiers API (`/catalog/products/{id}/modifiers`), used
 * only to auto-create a hidden text field that carries the Kickflip designId
 * through checkout onto the order (src/services/product-customize-service.ts).
 * Kept separate from catalog.ts's product create/update/list functions — this
 * is a narrower, single-purpose adapter for one specific write, not part of
 * the general catalog surface.
 *
 * FLAG: field names/values are an unverified assumption about the real API
 * shape — see docs/api-assumptions.md and bcModifierSchema's own note.
 */

const modifierResponseSchema = bcSingleResponseSchema(bcModifierSchema);

export interface CreateModifierInput {
  displayName: string;
  /** Max characters BigCommerce accepts for the shopper-facing text value. */
  textMaxLength?: number;
}

/**
 * Creates a non-required text-type modifier. `required: false` matters: this
 * field is filled by the storefront widget script when the Kickflip iframe
 * signals an add-to-cart, not by the shopper directly, so checkout must never
 * block on it being empty (e.g. a shopper who uses the plain Add to Cart
 * button without opening the customizer at all).
 */
export async function createModifier(
  client: BigCommerceApiClient,
  productId: number,
  input: CreateModifierInput,
): Promise<BcModifier> {
  const result = await client.requestJson<unknown>('POST', `/catalog/products/${productId}/modifiers`, {
    body: {
      type: 'text',
      display_name: input.displayName,
      required: false,
      config: {
        text_max_length: input.textMaxLength ?? 64,
      },
    },
  });

  const parsed = modifierResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while registering the Kickflip design reference field.',
    });
  }
  return parsed.data.data;
}
