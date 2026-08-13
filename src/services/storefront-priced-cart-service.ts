import type { Store } from '@prisma/client';
import { AppError } from '@/server/errors/app-error';
import type { AppLogger } from '@/server/logging/logger';
import { decryptSecret } from '@/server/crypto/encryption';
import { BigCommerceApiClient } from '@/lib/bigcommerce/client';
import { getProduct } from '@/lib/bigcommerce/catalog';
import {
  addCartLineItems,
  createCart,
  createCartRedirectUrl,
  type CartOptionSelectionInput,
} from '@/lib/bigcommerce/carts';
import { findCustomizeConfig } from '@/repositories/product-customize-repository';
import { findStoreByHash } from '@/repositories/store-repository';

const CART_MODIFY_SCOPE = 'store_cart';

export interface AddPricedKickflipCartItemInput {
  storeHash: string;
  bigcommerceProductId: number;
  variantId?: number | null;
  quantity: number;
  cartId?: string | null;
  kickflipPriceAdjustment: string | number;
  optionSelections: CartOptionSelectionInput[];
  correlationId: string;
  logger?: AppLogger;
}

export interface AddPricedKickflipCartItemResult {
  cartId: string;
  cartUrl: string;
  checkoutUrl: string | null;
  baseUnitPrice: string;
  kickflipPriceAdjustment: string;
  finalUnitPrice: string;
  usedExistingCart: boolean;
}

function assertCartScope(store: Store): void {
  const grantedScopes = new Set(store.scope.split(/\s+/).filter(Boolean));
  if (!grantedScopes.has(CART_MODIFY_SCOPE)) {
    throw new AppError('BIGCOMMERCE_SCOPE_MISMATCH', {
      publicDetail: 'Carts: Modify is required before Kickflip dynamic pricing can be applied.',
    });
  }
}

export function decimalToCents(value: string | number, fieldName: string): number {
  const text = String(value).trim();
  if (!/^-?\d+(\.\d{1,4})?$/.test(text)) {
    throw new AppError('VALIDATION_FAILED', { publicDetail: `${fieldName} must be a decimal.` });
  }

  const amount = Number(text);
  if (!Number.isFinite(amount)) {
    throw new AppError('VALIDATION_FAILED', { publicDetail: `${fieldName} must be finite.` });
  }
  return Math.round(amount * 100);
}

export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsToBigCommerceNumber(cents: number): number {
  return Number(centsToDecimalString(cents));
}

async function redirectUrlForNewCart(
  client: BigCommerceApiClient,
  cartId: string,
  existingCartUrl?: string,
  existingCheckoutUrl?: string,
): Promise<{ cartUrl: string; checkoutUrl: string | null }> {
  if (existingCartUrl) {
    return { cartUrl: existingCartUrl, checkoutUrl: existingCheckoutUrl ?? null };
  }

  const redirectUrls = await createCartRedirectUrl(client, cartId);
  if (!redirectUrls.cart_url) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'BigCommerce did not return a cart redirect URL.',
    });
  }

  return {
    cartUrl: redirectUrls.cart_url,
    checkoutUrl: redirectUrls.checkout_url ?? null,
  };
}

export async function addPricedKickflipCartItem(
  input: AddPricedKickflipCartItemInput,
): Promise<AddPricedKickflipCartItemResult> {
  const store = await findStoreByHash(input.storeHash);
  if (!store || !store.isActive) throw new AppError('STORE_INACTIVE');
  assertCartScope(store);

  const config = await findCustomizeConfig(store.id, input.bigcommerceProductId);
  if (!config || !config.enabled || !config.customizeUrl) {
    throw new AppError('NOT_FOUND', {
      publicDetail: 'This product does not have Kickflip customization enabled.',
    });
  }

  const client = new BigCommerceApiClient({
    storeHash: store.storeHash,
    accessToken: decryptSecret(store.encryptedAccessToken),
    correlationId: input.correlationId,
    logger: input.logger,
  });

  const product = await getProduct(client, input.bigcommerceProductId);
  if (!product || product.price === undefined) {
    throw new AppError('BIGCOMMERCE_PRODUCT_NOT_FOUND');
  }

  const baseCents = decimalToCents(product.price, 'Product price');
  const adjustmentCents = decimalToCents(
    input.kickflipPriceAdjustment,
    'Kickflip price adjustment',
  );
  const finalCents = baseCents + adjustmentCents;
  if (finalCents < 0) {
    throw new AppError('VALIDATION_FAILED', {
      publicDetail: 'Kickflip price adjustment makes the final product price negative.',
    });
  }

  const lineItem = {
    productId: input.bigcommerceProductId,
    variantId: input.variantId,
    quantity: input.quantity,
    listPrice: centsToBigCommerceNumber(finalCents),
    optionSelections: input.optionSelections,
  };

  if (input.cartId) {
    try {
      const cart = await addCartLineItems(client, input.cartId, { lineItems: [lineItem] });
      return {
        cartId: cart.id,
        cartUrl: '/cart.php',
        checkoutUrl: null,
        baseUnitPrice: centsToDecimalString(baseCents),
        kickflipPriceAdjustment: centsToDecimalString(adjustmentCents),
        finalUnitPrice: centsToDecimalString(finalCents),
        usedExistingCart: true,
      };
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'BIGCOMMERCE_PRODUCT_NOT_FOUND') {
        throw error;
      }
      input.logger?.warn(
        { cartId: input.cartId, productId: input.bigcommerceProductId },
        'Existing storefront cart was not usable for priced add; creating a new cart',
      );
    }
  }

  const cart = await createCart(client, { lineItems: [lineItem] });
  const redirect = await redirectUrlForNewCart(
    client,
    cart.id,
    cart.redirect_urls?.cart_url,
    cart.redirect_urls?.checkout_url,
  );

  return {
    cartId: cart.id,
    cartUrl: redirect.cartUrl,
    checkoutUrl: redirect.checkoutUrl,
    baseUnitPrice: centsToDecimalString(baseCents),
    kickflipPriceAdjustment: centsToDecimalString(adjustmentCents),
    finalUnitPrice: centsToDecimalString(finalCents),
    usedExistingCart: false,
  };
}
