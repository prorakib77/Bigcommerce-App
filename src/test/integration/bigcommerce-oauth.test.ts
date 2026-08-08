import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { mswServer } from '@/test/mocks/server';
import { resetDatabase } from '@/test/helpers/db-reset';
import { prisma } from '@/server/db/prisma';
import { getEnv } from '@/server/env';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
beforeEach(() => resetDatabase());

const CLIENT_SECRET = process.env.BIGCOMMERCE_CLIENT_SECRET!;
const CLIENT_ID = process.env.BIGCOMMERCE_CLIENT_ID!;

function mockTokenExchange(overrides: Record<string, unknown> = {}) {
  mswServer.use(
    http.post(`${getEnv().BIGCOMMERCE_LOGIN_BASE_URL}/oauth2/token`, () =>
      HttpResponse.json({
        access_token: 'live-access-token-should-never-be-logged',
        scope: 'store_v2_products',
        user: { id: 1000, email: 'owner@example.com' },
        context: 'stores/teststore1',
        account_uuid: 'acc-uuid-1',
        ...overrides,
      }),
    ),
  );
}

async function signCallbackJwt(payload: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('bc')
    .setAudience(CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(CLIENT_SECRET));
}

describe('BigCommerce OAuth install (auth callback)', () => {
  it('installs a new store and provisions the installing user as OWNER', async () => {
    mockTokenExchange();
    const { GET } = await import('@/app/api/bigcommerce/auth/route');

    const url = new URL('http://localhost:3000/api/bigcommerce/auth');
    url.searchParams.set('code', 'auth-code-123');
    url.searchParams.set('scope', 'store_v2_products store_v2_content store_v2_orders_read_only');
    url.searchParams.set('context', 'stores/teststore1');

    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Installation complete');

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    expect(store.isActive).toBe(true);
    expect(store.ownerEmail).toBe('owner@example.com');
    expect(store.encryptedAccessToken).not.toContain('live-access-token-should-never-be-logged');

    const owner = await prisma.storeUser.findFirstOrThrow({ where: { storeId: store.id } });
    expect(owner.role).toBe('OWNER');
    expect(owner.bigcommerceUserId).toBe('1000');
  });

  it('reactivates a previously-uninstalled store on repeat install', async () => {
    mockTokenExchange();
    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    const url = new URL('http://localhost:3000/api/bigcommerce/auth');
    url.searchParams.set('code', 'code-1');
    url.searchParams.set('scope', 'store_v2_products store_v2_content store_v2_orders_read_only');
    url.searchParams.set('context', 'stores/teststore1');

    await GET(new Request(url));
    await prisma.store.update({
      where: { storeHash: 'teststore1' },
      data: { isActive: false, uninstalledAt: new Date() },
    });

    mockTokenExchange();
    const secondResponse = await GET(new Request(url));
    expect(secondResponse.status).toBe(200);

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    expect(store.isActive).toBe(true);
    expect(store.uninstalledAt).toBeNull();
  });

  it('rejects installation when the granted scope does not include required scopes', async () => {
    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    const url = new URL('http://localhost:3000/api/bigcommerce/auth');
    url.searchParams.set('code', 'code-1');
    url.searchParams.set('scope', 'store_v2_content'); // missing store_v2_products
    url.searchParams.set('context', 'stores/teststore1');

    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
    const store = await prisma.store.findUnique({ where: { storeHash: 'teststore1' } });
    expect(store).toBeNull();
  });
});

describe('BigCommerce load callback + multi-user provisioning', () => {
  async function installStore() {
    mockTokenExchange();
    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    const url = new URL('http://localhost:3000/api/bigcommerce/auth');
    url.searchParams.set('code', 'code-1');
    url.searchParams.set('scope', 'store_v2_products store_v2_content store_v2_orders_read_only');
    url.searchParams.set('context', 'stores/teststore1');
    await GET(new Request(url));
    return prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
  }

  it('issues a bootstrap redirect for the owner and a session exchanges cleanly', async () => {
    await installStore();
    const { GET: loadGet } = await import('@/app/api/bigcommerce/load/route');

    const token = await signCallbackJwt({
      sub: 'stores/teststore1',
      user: { id: 1000, email: 'owner@example.com' },
      owner: { id: 1000, email: 'owner@example.com' },
    });

    const loadUrl = new URL('http://localhost:3000/api/bigcommerce/load');
    loadUrl.searchParams.set('signed_payload_jwt', token);
    const loadResponse = await loadGet(new Request(loadUrl));
    expect(loadResponse.status).toBe(302);

    const redirectLocation = new URL(loadResponse.headers.get('location')!);
    const code = redirectLocation.searchParams.get('bootstrap');
    expect(code).toBeTruthy();

    const { POST: bootstrapPost } = await import('@/app/api/v1/session/bootstrap/route');
    const bootstrapResponse = await bootstrapPost(
      new Request('http://localhost:3000/api/v1/session/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
    );
    expect(bootstrapResponse.status).toBe(200);
    const body = (await bootstrapResponse.json()) as { data: { token: string; role: string } };
    expect(body.data.role).toBe('OWNER');
    expect(body.data.token).toBeTruthy();

    // The one-time code must not be usable a second time.
    const replay = await bootstrapPost(
      new Request('http://localhost:3000/api/v1/session/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
    );
    expect(replay.status).toBe(401);

    const { GET: sessionGet } = await import('@/app/api/v1/session/route');
    const sessionResponse = await sessionGet(
      new Request('http://localhost:3000/api/v1/session', {
        headers: { Authorization: `Bearer ${body.data.token}` },
      }),
    );
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as { data: { role: string; email: string } };
    expect(sessionBody.data.role).toBe('OWNER');
    expect(sessionBody.data.email).toBe('owner@example.com');
  });

  it('provisions a second staff user as USER (not OWNER) based on the owner claim', async () => {
    const store = await installStore();
    const { GET: loadGet } = await import('@/app/api/bigcommerce/load/route');

    const staffToken = await signCallbackJwt({
      sub: 'stores/teststore1',
      user: { id: 2000, email: 'staff@example.com' },
      owner: { id: 1000, email: 'owner@example.com' },
    });
    const loadUrl = new URL('http://localhost:3000/api/bigcommerce/load');
    loadUrl.searchParams.set('signed_payload_jwt', staffToken);
    await loadGet(new Request(loadUrl));

    const staffUser = await prisma.storeUser.findFirstOrThrow({
      where: { storeId: store.id, bigcommerceUserId: '2000' },
    });
    expect(staffUser.role).toBe('USER');
  });

  it('rejects a load callback for a store user that was removed', async () => {
    const store = await installStore();
    await prisma.storeUser.create({
      data: {
        storeId: store.id,
        bigcommerceUserId: '3000',
        email: 'removed@example.com',
        role: 'USER',
        isActive: false,
        removedAt: new Date(),
      },
    });

    const { GET: loadGet } = await import('@/app/api/bigcommerce/load/route');
    const token = await signCallbackJwt({
      sub: 'stores/teststore1',
      user: { id: 3000, email: 'removed@example.com' },
      owner: { id: 1000, email: 'owner@example.com' },
    });
    const loadUrl = new URL('http://localhost:3000/api/bigcommerce/load');
    loadUrl.searchParams.set('signed_payload_jwt', token);
    const response = await loadGet(new Request(loadUrl));
    expect(response.status).toBe(403);
  });
});

describe('BigCommerce remove-user callback', () => {
  it('deactivates the targeted user and revokes their sessions, preserving the store', async () => {
    mockTokenExchange();
    const { GET: authGet } = await import('@/app/api/bigcommerce/auth/route');
    const authUrl = new URL('http://localhost:3000/api/bigcommerce/auth');
    authUrl.searchParams.set('code', 'code-1');
    authUrl.searchParams.set('scope', 'store_v2_products store_v2_content store_v2_orders_read_only');
    authUrl.searchParams.set('context', 'stores/teststore1');
    await authGet(new Request(authUrl));

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    const owner = await prisma.storeUser.findFirstOrThrow({ where: { storeId: store.id } });
    const session = await prisma.appSession.create({
      data: {
        storeId: store.id,
        storeUserId: owner.id,
        hashedTokenId: 'x'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { GET: removeUserGet } = await import('@/app/api/bigcommerce/remove-user/route');
    const token = await signCallbackJwt({
      sub: 'stores/teststore1',
      user: { id: 1000, email: 'owner@example.com' },
      owner: { id: 1000, email: 'owner@example.com' },
    });
    const url = new URL('http://localhost:3000/api/bigcommerce/remove-user');
    url.searchParams.set('signed_payload_jwt', token);
    const response = await removeUserGet(new Request(url));
    expect(response.status).toBe(200);

    const updatedUser = await prisma.storeUser.findUniqueOrThrow({ where: { id: owner.id } });
    expect(updatedUser.isActive).toBe(false);

    const updatedSession = await prisma.appSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(updatedSession.revokedAt).not.toBeNull();

    const stillActiveStore = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(stillActiveStore.isActive).toBe(true);
  });
});

describe('BigCommerce uninstall callback', () => {
  it('deactivates the store, cancels queued imports, and preserves mappings', async () => {
    mockTokenExchange();
    const { GET: authGet } = await import('@/app/api/bigcommerce/auth/route');
    const authUrl = new URL('http://localhost:3000/api/bigcommerce/auth');
    authUrl.searchParams.set('code', 'code-1');
    authUrl.searchParams.set('scope', 'store_v2_products store_v2_content store_v2_orders_read_only');
    authUrl.searchParams.set('context', 'stores/teststore1');
    await authGet(new Request(authUrl));

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    const owner = await prisma.storeUser.findFirstOrThrow({ where: { storeId: store.id } });

    const mapping = await prisma.importMapping.create({
      data: {
        storeId: store.id,
        kickflipDesignId: 'design-1',
        bigcommerceProductId: 555,
        sourceFingerprint: 'fp',
        status: 'ACTIVE',
      },
    });
    const queuedRun = await prisma.importRun.create({
      data: {
        storeId: store.id,
        storeUserId: owner.id,
        mappingId: mapping.id,
        kickflipDesignId: 'design-1',
        operation: 'UPDATE_DESIGN',
        status: 'QUEUED',
        idempotencyKey: `k-${randomUUID()}`,
        optionsSnapshot: {},
        correlationId: 'corr-1',
      },
    });

    const { GET: uninstallGet } = await import('@/app/api/bigcommerce/uninstall/route');
    const token = await signCallbackJwt({
      sub: 'stores/teststore1',
      user: { id: 1000, email: 'owner@example.com' },
      owner: { id: 1000, email: 'owner@example.com' },
    });
    const url = new URL('http://localhost:3000/api/bigcommerce/uninstall');
    url.searchParams.set('signed_payload_jwt', token);
    const response = await uninstallGet(new Request(url));
    expect(response.status).toBe(200);

    const updatedStore = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(updatedStore.isActive).toBe(false);
    expect(updatedStore.uninstalledAt).not.toBeNull();

    const updatedRun = await prisma.importRun.findUniqueOrThrow({ where: { id: queuedRun.id } });
    expect(updatedRun.status).toBe('CANCELLED');

    // Mappings are preserved — uninstall never touches BigCommerce products.
    const preservedMapping = await prisma.importMapping.findUniqueOrThrow({
      where: { id: mapping.id },
    });
    expect(preservedMapping.bigcommerceProductId).toBe(555);
  });
});
