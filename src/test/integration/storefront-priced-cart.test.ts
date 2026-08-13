import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { prisma } from '@/server/db/prisma';
import { getEnv } from '@/server/env';
import { resetRateLimitStoreForTests } from '@/server/rate-limit';
import { resetDatabase } from '@/test/helpers/db-reset';
import { seedStore } from '@/test/factories/store-factory';
import { mswServer } from '@/test/mocks/server';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
beforeEach(async () => {
  resetRateLimitStoreForTests();
  await resetDatabase();
});

describe('POST /api/public/storefront/priced-cart', () => {
  it('creates a BigCommerce cart with the merged Kickflip unit price', async () => {
    const { store } = await seedStore({ storeHash: 'teststore1' });
    await prisma.store.update({
      where: { id: store.id },
      data: { scope: 'store_v2_products store_cart' },
    });
    await prisma.productCustomizeConfig.create({
      data: {
        storeId: store.id,
        bigcommerceProductId: 86,
        enabled: true,
        customizeUrl: 'https://customizer.example.com/embed/abc',
      },
    });

    const managementCartBodies: unknown[] = [];
    mswServer.use(
      http.get(
        `${getEnv().BIGCOMMERCE_API_BASE_URL}/stores/teststore1/v3/catalog/products/86`,
        () =>
          HttpResponse.json({
            data: {
              id: 86,
              name: 'Santa Minifig',
              price: '8.00',
            },
          }),
      ),
      http.post(
        `${getEnv().BIGCOMMERCE_API_BASE_URL}/stores/teststore1/v3/carts`,
        async ({ request }) => {
          managementCartBodies.push(await request.json());
          return HttpResponse.json({
            data: {
              id: '11111111-1111-1111-1111-111111111111',
              redirect_urls: {
                cart_url:
                  'https://fab-bricks.com/cart.php?action=load&id=11111111-1111-1111-1111-111111111111',
                checkout_url:
                  'https://fab-bricks.com/checkout?action=load&id=11111111-1111-1111-1111-111111111111',
              },
            },
          });
        },
      ),
    );

    const { POST } = await import('@/app/api/public/storefront/priced-cart/route');
    const response = await POST(
      new Request('http://localhost:3000/api/public/storefront/priced-cart', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.25',
        },
        body: JSON.stringify({
          storeHash: 'teststore1',
          productId: 86,
          variantId: 701,
          cartId: null,
          quantity: 3,
          kickflipPriceAdjustment: '2.50',
          optionSelections: [
            { optionId: 333, optionValue: 'test' },
            { optionId: 111, optionValue: 'design-123' },
            { optionId: 222, optionValue: 'Skin Tones: Yellow' },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');

    const body = (await response.json()) as {
      data: {
        cartId: string;
        cartUrl: string;
        checkoutUrl: string | null;
        baseUnitPrice: string;
        kickflipPriceAdjustment: string;
        finalUnitPrice: string;
        usedExistingCart: boolean;
      };
    };
    expect(body.data).toMatchObject({
      cartId: '11111111-1111-1111-1111-111111111111',
      cartUrl:
        'https://fab-bricks.com/cart.php?action=load&id=11111111-1111-1111-1111-111111111111',
      checkoutUrl:
        'https://fab-bricks.com/checkout?action=load&id=11111111-1111-1111-1111-111111111111',
      baseUnitPrice: '8.00',
      kickflipPriceAdjustment: '2.50',
      finalUnitPrice: '10.50',
      usedExistingCart: false,
    });
    expect(managementCartBodies).toEqual([
      {
        line_items: [
          {
            product_id: 86,
            variant_id: 701,
            quantity: 3,
            list_price: 10.5,
            option_selections: [
              { option_id: 333, option_value: 'test' },
              { option_id: 111, option_value: 'design-123' },
              { option_id: 222, option_value: 'Skin Tones: Yellow' },
            ],
          },
        ],
      },
    ]);
  });
});
