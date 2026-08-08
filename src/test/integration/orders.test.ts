import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import { resetDatabase } from '@/test/helpers/db-reset';
import { seedStore } from '@/test/factories/store-factory';
import { issueAppSession } from '@/server/session';

beforeEach(() => resetDatabase());

async function bearerFor(
  storeId: string,
  storeUserId: string,
  bigcommerceUserId: string,
  role: 'OWNER' | 'USER',
) {
  const session = await issueAppSession({ storeId, storeUserId, bigcommerceUserId, role });
  return `Bearer ${session.token}`;
}

async function seedStaffUser(storeId: string) {
  await prisma.storeUser.create({
    data: {
      storeId,
      bigcommerceUserId: '2000',
      email: 'staff@example.com',
      role: 'USER',
      isActive: true,
    },
  });
  return prisma.storeUser.findUniqueOrThrow({
    where: { storeId_bigcommerceUserId: { storeId, bigcommerceUserId: '2000' } },
  });
}

describe('GET /api/v1/orders', () => {
  it('lists cached orders for the store, newest first', async () => {
    const { store, owner } = await seedStore();
    await prisma.order.create({
      data: { storeId: store.id, bigcommerceOrderId: 1, status: 'Completed', totalIncTax: '10.00' },
    });
    await prisma.order.create({
      data: { storeId: store.id, bigcommerceOrderId: 2, status: 'Shipped', totalIncTax: '20.00' },
    });

    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');
    const { GET } = await import('@/app/api/v1/orders/route');
    const response = await GET(
      new Request('http://localhost:3000/api/v1/orders?limit=20', {
        headers: { Authorization: auth },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ bigcommerceOrderId: number }> };
    expect(body.data.map((order) => order.bigcommerceOrderId)).toEqual([2, 1]);
  });

  it('scopes orders to the requesting store only', async () => {
    const { store: storeA, owner: ownerA } = await seedStore();
    const { store: storeB } = await seedStore();
    await prisma.order.create({
      data: { storeId: storeA.id, bigcommerceOrderId: 1, status: 'Completed', totalIncTax: '10.00' },
    });
    await prisma.order.create({
      data: { storeId: storeB.id, bigcommerceOrderId: 2, status: 'Completed', totalIncTax: '10.00' },
    });

    const auth = await bearerFor(storeA.id, ownerA.id, ownerA.bigcommerceUserId, 'OWNER');
    const { GET } = await import('@/app/api/v1/orders/route');
    const response = await GET(
      new Request('http://localhost:3000/api/v1/orders', { headers: { Authorization: auth } }),
    );
    const body = (await response.json()) as { data: Array<{ bigcommerceOrderId: number }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.bigcommerceOrderId).toBe(1);
  });

  it('rejects requests with no session at all', async () => {
    const { GET } = await import('@/app/api/v1/orders/route');
    const response = await GET(new Request('http://localhost:3000/api/v1/orders'));
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/orders/sync', () => {
  it('lets the owner sync recent orders from the mock catalog', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { POST } = await import('@/app/api/v1/orders/sync/route');
    const response = await POST(
      new Request('http://localhost:3000/api/v1/orders/sync', {
        method: 'POST',
        headers: { Authorization: auth },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { syncedCount: number } };
    expect(body.data.syncedCount).toBeGreaterThan(0);

    const orders = await prisma.order.findMany({ where: { storeId: store.id } });
    expect(orders.length).toBe(body.data.syncedCount);
  });

  it('lets a USER-role staff member sync too', async () => {
    const { store } = await seedStore();
    const staff = await seedStaffUser(store.id);
    const auth = await bearerFor(store.id, staff.id, staff.bigcommerceUserId, 'USER');

    const { POST } = await import('@/app/api/v1/orders/sync/route');
    const response = await POST(
      new Request('http://localhost:3000/api/v1/orders/sync', {
        method: 'POST',
        headers: { Authorization: auth },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('self-heals webhook registration when not yet registered (mock mode: sentinel id)', async () => {
    const { store, owner } = await seedStore();
    expect(store.ordersWebhookId).toBeNull();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { POST } = await import('@/app/api/v1/orders/sync/route');
    await POST(
      new Request('http://localhost:3000/api/v1/orders/sync', {
        method: 'POST',
        headers: { Authorization: auth },
      }),
    );

    // The self-heal call is fire-and-forget (see order-service.ts) — give
    // the microtask/DB round trip a moment to land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const updated = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(updated.ordersWebhookId).not.toBeNull();
    expect(updated.ordersWebhookSecret).toBeTruthy();
  });

  it('rejects requests with no session at all', async () => {
    const { POST } = await import('@/app/api/v1/orders/sync/route');
    const response = await POST(
      new Request('http://localhost:3000/api/v1/orders/sync', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
  });
});
