import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import { resetDatabase } from '@/test/helpers/db-reset';
import { seedStore } from '@/test/factories/store-factory';
import { resetRateLimitStoreForTests } from '@/server/rate-limit';
import { ORDERS_WEBHOOK_SECRET_HEADER } from '@/services/orders-webhook-service';

beforeEach(() => {
  resetRateLimitStoreForTests();
  return resetDatabase();
});

const TEST_SECRET = 'test-secret-value-1234567890abcdef';

async function registerWebhook(storeId: string): Promise<string> {
  await prisma.store.update({
    where: { id: storeId },
    data: { ordersWebhookId: 999, ordersWebhookSecret: TEST_SECRET, ordersWebhookRegisteredAt: new Date() },
  });
  return TEST_SECRET;
}

function webhookUrl(storeHash: string): URL {
  const url = new URL('http://localhost:3000/api/public/webhooks/bigcommerce/orders');
  url.searchParams.set('storeHash', storeHash);
  return url;
}

describe('POST /api/public/webhooks/bigcommerce/orders', () => {
  it('accepts a valid delivery, re-fetches the order from BigCommerce, and persists it', async () => {
    const { store } = await seedStore();
    const secret = await registerWebhook(store.id);

    const { POST } = await import('@/app/api/public/webhooks/bigcommerce/orders/route');
    const response = await POST(
      new Request(webhookUrl(store.storeHash), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ORDERS_WEBHOOK_SECRET_HEADER]: secret },
        body: JSON.stringify({ data: { type: 'order', id: 500001 } }),
      }),
    );
    expect(response.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({
      where: { storeId_bigcommerceOrderId: { storeId: store.id, bigcommerceOrderId: 500001 } },
    });
    // 500001 is one of orders-service.ts's MockOrdersService fixture orders.
    expect(order.status).toBe('Completed');
    expect(order.totalIncTax).toBe('99.98');
    expect(order.customerName).toBe('Leo Novak');
  });

  it('rejects a delivery with the wrong secret', async () => {
    const { store } = await seedStore();
    await registerWebhook(store.id);

    const { POST } = await import('@/app/api/public/webhooks/bigcommerce/orders/route');
    const response = await POST(
      new Request(webhookUrl(store.storeHash), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ORDERS_WEBHOOK_SECRET_HEADER]: 'wrong-secret-value' },
        body: JSON.stringify({ data: { type: 'order', id: 500001 } }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a delivery with no secret header at all', async () => {
    const { store } = await seedStore();
    await registerWebhook(store.id);

    const { POST } = await import('@/app/api/public/webhooks/bigcommerce/orders/route');
    const response = await POST(
      new Request(webhookUrl(store.storeHash), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'order', id: 500001 } }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a delivery when the store has never completed webhook registration', async () => {
    const { store } = await seedStore();
    // No registerWebhook call — ordersWebhookSecret stays null.

    const { POST } = await import('@/app/api/public/webhooks/bigcommerce/orders/route');
    const response = await POST(
      new Request(webhookUrl(store.storeHash), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ORDERS_WEBHOOK_SECRET_HEADER]: 'anything-at-all' },
        body: JSON.stringify({ data: { type: 'order', id: 500001 } }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('returns 200 no-op for an unknown store, never revealing existence', async () => {
    const { POST } = await import('@/app/api/public/webhooks/bigcommerce/orders/route');
    const response = await POST(
      new Request(webhookUrl('nosuchstore'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ORDERS_WEBHOOK_SECRET_HEADER]: 'anything' },
        body: JSON.stringify({ data: { type: 'order', id: 1 } }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('returns 200 no-op for an inactive store', async () => {
    const { store } = await seedStore();
    const secret = await registerWebhook(store.id);
    await prisma.store.update({ where: { id: store.id }, data: { isActive: false } });

    const { POST } = await import('@/app/api/public/webhooks/bigcommerce/orders/route');
    const response = await POST(
      new Request(webhookUrl(store.storeHash), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ORDERS_WEBHOOK_SECRET_HEADER]: secret },
        body: JSON.stringify({ data: { type: 'order', id: 500001 } }),
      }),
    );
    expect(response.status).toBe(200);
    const order = await prisma.order.findUnique({
      where: { storeId_bigcommerceOrderId: { storeId: store.id, bigcommerceOrderId: 500001 } },
    });
    expect(order).toBeNull();
  });

  it('rejects a malformed body', async () => {
    const { store } = await seedStore();
    const secret = await registerWebhook(store.id);

    const { POST } = await import('@/app/api/public/webhooks/bigcommerce/orders/route');
    const response = await POST(
      new Request(webhookUrl(store.storeHash), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ORDERS_WEBHOOK_SECRET_HEADER]: secret },
        body: JSON.stringify({ nonsense: true }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a missing storeHash query param', async () => {
    const { POST } = await import('@/app/api/public/webhooks/bigcommerce/orders/route');
    const response = await POST(
      new Request('http://localhost:3000/api/public/webhooks/bigcommerce/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('updates an existing cached order in place rather than duplicating it', async () => {
    const { store } = await seedStore();
    const secret = await registerWebhook(store.id);

    const { POST } = await import('@/app/api/public/webhooks/bigcommerce/orders/route');
    const request = () =>
      new Request(webhookUrl(store.storeHash), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ORDERS_WEBHOOK_SECRET_HEADER]: secret },
        body: JSON.stringify({ data: { type: 'order', id: 500002 } }),
      });

    await POST(request());
    await POST(request());

    const orders = await prisma.order.findMany({
      where: { storeId: store.id, bigcommerceOrderId: 500002 },
    });
    expect(orders).toHaveLength(1);
  });
});
