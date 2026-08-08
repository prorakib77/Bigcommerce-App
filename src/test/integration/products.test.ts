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

describe('GET /api/v1/bigcommerce/products', () => {
  it('lists the mock-mode fixture products for an authenticated store', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { GET } = await import('@/app/api/v1/bigcommerce/products/route');
    const response = await GET(
      new Request('http://localhost:3000/api/v1/bigcommerce/products?page=1&limit=20', {
        headers: { Authorization: auth },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ product: { id: number; name: string }; hasCustomizeConfig: boolean }>;
      meta: { currentPage: number; totalPages: number };
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((item) => item.hasCustomizeConfig === false)).toBe(true);
    expect(body.meta.currentPage).toBe(1);
  });

  it('rejects requests with no session at all', async () => {
    const { GET } = await import('@/app/api/v1/bigcommerce/products/route');
    const response = await GET(new Request('http://localhost:3000/api/v1/bigcommerce/products'));
    expect(response.status).toBe(401);
  });
});

describe('GET/PUT /api/v1/bigcommerce/products/[productId]', () => {
  it('returns product detail with null mapping/customizeConfig for a non-Kickflip product', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { GET } = await import('@/app/api/v1/bigcommerce/products/[productId]/route');
    const response = await GET(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/100001', {
        headers: { Authorization: auth },
      }),
      { params: Promise.resolve({ productId: '100001' }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { product: { id: number }; mapping: unknown; customizeConfig: unknown };
    };
    expect(body.data.product.id).toBe(100001);
    expect(body.data.mapping).toBeNull();
    expect(body.data.customizeConfig).toBeNull();
  });

  it('lets the owner update basic fields', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { PUT } = await import('@/app/api/v1/bigcommerce/products/[productId]/route');
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/100002', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Product', isVisible: false }),
      }),
      { params: Promise.resolve({ productId: '100002' }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { name: string; is_visible: boolean } };
    expect(body.data.name).toBe('Renamed Product');
    expect(body.data.is_visible).toBe(false);
  });

  it('lets a USER-role staff member update basic fields too', async () => {
    const { store } = await seedStore();
    const staff = await seedStaffUser(store.id);
    const auth = await bearerFor(store.id, staff.id, staff.bigcommerceUserId, 'USER');

    const { PUT } = await import('@/app/api/v1/bigcommerce/products/[productId]/route');
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/100003', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Staff Renamed' }),
      }),
      { params: Promise.resolve({ productId: '100003' }) },
    );
    expect(response.status).toBe(200);
  });

  it('rejects an invalid price value', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { PUT } = await import('@/app/api/v1/bigcommerce/products/[productId]/route');
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/100004', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: 'not-a-price' }),
      }),
      { params: Promise.resolve({ productId: '100004' }) },
    );
    expect(response.status).toBe(400);
  });

  it('404s for a product id that does not exist in the mock catalog', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { GET } = await import('@/app/api/v1/bigcommerce/products/[productId]/route');
    const response = await GET(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/999999999', {
        headers: { Authorization: auth },
      }),
      { params: Promise.resolve({ productId: '999999999' }) },
    );
    expect(response.status).toBe(404);
  });
});

describe('PUT /api/v1/bigcommerce/products/[productId]/customize', () => {
  it('lets the owner save a customize config', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { PUT } = await import(
      '@/app/api/v1/bigcommerce/products/[productId]/customize/route'
    );
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/100005/customize', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          customizeUrl: 'https://customizer.example.com/embed/abc',
          buttonLabel: 'Design it',
        }),
      }),
      { params: Promise.resolve({ productId: '100005' }) },
    );
    expect(response.status).toBe(200);

    const saved = await prisma.productCustomizeConfig.findUniqueOrThrow({
      where: { storeId_bigcommerceProductId: { storeId: store.id, bigcommerceProductId: 100005 } },
    });
    expect(saved.enabled).toBe(true);
    expect(saved.customizeUrl).toBe('https://customizer.example.com/embed/abc');
    expect(saved.buttonLabel).toBe('Design it');
  });

  it('lets a USER-role staff member save a customize config too', async () => {
    const { store } = await seedStore();
    const staff = await seedStaffUser(store.id);
    const auth = await bearerFor(store.id, staff.id, staff.bigcommerceUserId, 'USER');

    const { PUT } = await import(
      '@/app/api/v1/bigcommerce/products/[productId]/customize/route'
    );
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/100006/customize', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, customizeUrl: null }),
      }),
      { params: Promise.resolve({ productId: '100006' }) },
    );
    expect(response.status).toBe(200);
  });

  it('rejects enabled:true with no customizeUrl', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { PUT } = await import(
      '@/app/api/v1/bigcommerce/products/[productId]/customize/route'
    );
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/100007/customize', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, customizeUrl: null }),
      }),
      { params: Promise.resolve({ productId: '100007' }) },
    );
    expect(response.status).toBe(400);
  });

  it('rejects a non-https customizeUrl', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { PUT } = await import(
      '@/app/api/v1/bigcommerce/products/[productId]/customize/route'
    );
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/100008/customize', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, customizeUrl: 'http://not-https.example.com' }),
      }),
      { params: Promise.resolve({ productId: '100008' }) },
    );
    expect(response.status).toBe(400);
  });

  it('rejects requests with no session at all', async () => {
    const { PUT } = await import(
      '@/app/api/v1/bigcommerce/products/[productId]/customize/route'
    );
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/bigcommerce/products/100009/customize', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, customizeUrl: null }),
      }),
      { params: Promise.resolve({ productId: '100009' }) },
    );
    expect(response.status).toBe(401);
  });
});
