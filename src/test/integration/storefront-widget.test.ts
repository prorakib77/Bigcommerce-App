import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import { resetDatabase } from '@/test/helpers/db-reset';
import { seedStore } from '@/test/factories/store-factory';
import { resetRateLimitStoreForTests } from '@/server/rate-limit';
import { __resetEnvCacheForTests } from '@/server/env';

beforeEach(() => {
  resetRateLimitStoreForTests();
  return resetDatabase();
});

const ORIGINAL_RATE_LIMIT_MAX = process.env.RATE_LIMIT_STOREFRONT_MAX;
afterEach(() => {
  process.env.RATE_LIMIT_STOREFRONT_MAX = ORIGINAL_RATE_LIMIT_MAX;
  __resetEnvCacheForTests();
});

describe('GET /api/public/storefront/customize-config', () => {
  it('returns the enabled config with a CORS header for a configured product', async () => {
    const { store } = await seedStore();
    await prisma.productCustomizeConfig.create({
      data: {
        storeId: store.id,
        bigcommerceProductId: 100010,
        enabled: true,
        customizeUrl: 'https://customizer.example.com/embed/xyz',
        buttonLabel: 'Customize it',
      },
    });

    const { GET } = await import('@/app/api/public/storefront/customize-config/route');
    const url = new URL('http://localhost:3000/api/public/storefront/customize-config');
    url.searchParams.set('storeHash', store.storeHash);
    url.searchParams.set('productId', '100010');
    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toContain('max-age=30');
    const body = (await response.json()) as {
      data: {
        enabled: boolean;
        customizeUrl: string;
        buttonLabel: string;
        modifierId: number | null;
        summaryModifierId: number | null;
      };
    };
    expect(body.data).toEqual({
      enabled: true,
      customizeUrl: 'https://customizer.example.com/embed/xyz',
      buttonLabel: 'Customize it',
      modifierId: null,
      summaryModifierId: null,
    });
  });

  it('returns a disabled default for an unknown store — never a 404', async () => {
    const { GET } = await import('@/app/api/public/storefront/customize-config/route');
    const url = new URL('http://localhost:3000/api/public/storefront/customize-config');
    url.searchParams.set('storeHash', 'nosuchstore');
    url.searchParams.set('productId', '1');
    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { enabled: boolean; customizeUrl: null } };
    expect(body.data).toEqual({
      enabled: false,
      customizeUrl: null,
      buttonLabel: 'Customize',
      modifierId: null,
      summaryModifierId: null,
    });
  });

  it('returns a disabled default for an inactive store', async () => {
    const { store } = await seedStore();
    await prisma.store.update({ where: { id: store.id }, data: { isActive: false } });

    const { GET } = await import('@/app/api/public/storefront/customize-config/route');
    const url = new URL('http://localhost:3000/api/public/storefront/customize-config');
    url.searchParams.set('storeHash', store.storeHash);
    url.searchParams.set('productId', '1');
    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { enabled: boolean } };
    expect(body.data.enabled).toBe(false);
  });

  it('returns a disabled default when a config row exists but is disabled', async () => {
    const { store } = await seedStore();
    await prisma.productCustomizeConfig.create({
      data: { storeId: store.id, bigcommerceProductId: 100011, enabled: false, customizeUrl: null },
    });

    const { GET } = await import('@/app/api/public/storefront/customize-config/route');
    const url = new URL('http://localhost:3000/api/public/storefront/customize-config');
    url.searchParams.set('storeHash', store.storeHash);
    url.searchParams.set('productId', '100011');
    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { enabled: boolean } };
    expect(body.data.enabled).toBe(false);
  });

  it('rejects a malformed storeHash', async () => {
    const { GET } = await import('@/app/api/public/storefront/customize-config/route');
    const url = new URL('http://localhost:3000/api/public/storefront/customize-config');
    url.searchParams.set('storeHash', 'not valid! hash');
    url.searchParams.set('productId', '1');
    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
  });

  it('enforces the storefront rate limit', async () => {
    process.env.RATE_LIMIT_STOREFRONT_MAX = '3';
    __resetEnvCacheForTests();

    const { GET } = await import('@/app/api/public/storefront/customize-config/route');
    const url = new URL('http://localhost:3000/api/public/storefront/customize-config');
    url.searchParams.set('storeHash', 'nosuchstore');
    url.searchParams.set('productId', '1');
    const headers = { 'x-forwarded-for': '203.0.113.5' };

    for (let i = 0; i < 3; i += 1) {
      const response = await GET(new Request(url, { headers }));
      expect(response.status).toBe(200);
    }

    const limited = await GET(new Request(url, { headers }));
    expect(limited.status).toBe(429);
  });
});
