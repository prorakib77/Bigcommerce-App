import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';
import {
  bcCartRedirectResponseSchema,
  bcCartSchema,
  bcSingleResponseSchema,
  type BcCart,
  type BcCartRedirectUrls,
} from './schemas';

export interface CartOptionSelectionInput {
  optionId: number;
  optionValue: string | number;
}

export interface CartLineItemInput {
  productId: number;
  variantId?: number | null;
  quantity: number;
  listPrice?: number;
  optionSelections?: CartOptionSelectionInput[];
}

const cartResponseSchema = bcSingleResponseSchema(bcCartSchema);

function toManagementLineItem(input: CartLineItemInput): Record<string, unknown> {
  const lineItem: Record<string, unknown> = {
    product_id: input.productId,
    quantity: input.quantity,
  };

  if (input.variantId) lineItem.variant_id = input.variantId;
  if (input.listPrice !== undefined) lineItem.list_price = input.listPrice;
  if (input.optionSelections?.length) {
    lineItem.option_selections = input.optionSelections.map((selection) => ({
      option_id: selection.optionId,
      option_value: selection.optionValue,
    }));
  }

  return lineItem;
}

export async function createCart(
  client: BigCommerceApiClient,
  input: { lineItems: CartLineItemInput[] },
): Promise<BcCart> {
  const result = await client.requestJson<unknown>('POST', '/carts', {
    query: {
      include: 'redirect_urls,line_items.physical_items.options,line_items.digital_items.options',
    },
    body: {
      line_items: input.lineItems.map(toManagementLineItem),
    },
  });

  const parsed = cartResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while creating a priced BigCommerce cart.',
    });
  }
  return parsed.data.data;
}

export async function addCartLineItems(
  client: BigCommerceApiClient,
  cartId: string,
  input: { lineItems: CartLineItemInput[] },
): Promise<BcCart> {
  const result = await client.requestJson<unknown>(
    'POST',
    `/carts/${encodeURIComponent(cartId)}/items`,
    {
      query: { include: 'line_items.physical_items.options,line_items.digital_items.options' },
      body: {
        line_items: input.lineItems.map(toManagementLineItem),
      },
    },
  );

  const parsed = cartResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while adding a priced BigCommerce cart item.',
    });
  }
  return parsed.data.data;
}

export async function createCartRedirectUrl(
  client: BigCommerceApiClient,
  cartId: string,
): Promise<BcCartRedirectUrls> {
  const result = await client.requestJson<unknown>(
    'POST',
    `/carts/${encodeURIComponent(cartId)}/redirect_urls`,
    { body: {} },
  );

  const parsed = bcCartRedirectResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while creating a BigCommerce cart redirect.',
    });
  }
  return parsed.data.data;
}
