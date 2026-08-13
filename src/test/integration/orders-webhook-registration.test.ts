import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/mocks/server';
import { resetDatabase } from '@/test/helpers/db-reset';
import { prisma } from '@/server/db/prisma';
import { getEnv, __resetEnvCacheForTests } from '@/server/env';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
beforeEach(() => resetDatabase());

// This is the one integration test file that legitimately needs MOCK_MODE
// off to exercise the real network call — ensureOrdersWebhookRegistered's
// MOCK_MODE gate is what these tests exist to bypass and test directly (it
// only gates the network call, not the secret generation/persistence — see
// docs/architecture.md#orders-webhook-sync).
const ORIGINAL_MOCK_MODE = process.env.MOCK_MODE;
afterEach(() => {
  process.env.MOCK_MODE = ORIGINAL_MOCK_MODE;
  __resetEnvCacheForTests();
});

function mockTokenExchange(overrides: Record<string, unknown> = {}) {
  mswServer.use(
    http.post(`${getEnv().BIGCOMMERCE_LOGIN_BASE_URL}/oauth2/token`, () =>
      HttpResponse.json({
        access_token: 'live-access-token-should-never-be-logged',
        scope: 'store_v2_products store_v2_content store_v2_orders_read_only store_cart',
        user: { id: 1000, email: 'owner@example.com' },
        context: 'stores/teststore1',
        account_uuid: 'acc-uuid-1',
        ...overrides,
      }),
    ),
  );
}

function installUrl(): URL {
  const url = new URL('http://localhost:3000/api/bigcommerce/auth');
  url.searchParams.set('code', 'code-1');
  url.searchParams.set(
    'scope',
    'store_v2_products store_v2_content store_v2_orders_read_only store_cart',
  );
  url.searchParams.set('context', 'stores/teststore1');
  return url;
}

// auth/route.ts also calls ensureStorefrontScriptRegistered before
// ensureOrdersWebhookRegistered — this file isn't testing that, so it just
// needs a default success handler to avoid an unrelated unhandled-request
// failure. See storefront-script-registration.test.ts for its dedicated tests.
function mockScriptEndpointDefault(): void {
  mswServer.use(
    http.post(`${getEnv().BIGCOMMERCE_API_BASE_URL}/stores/teststore1/v3/content/scripts`, () =>
      HttpResponse.json({ data: { uuid: 'script-uuid-1', name: 'Customize widget' } }),
    ),
  );
}

function mockHooksEndpoint(handler: () => Response) {
  mswServer.use(
    http.post(`${getEnv().BIGCOMMERCE_API_BASE_URL}/stores/teststore1/v3/hooks`, handler),
  );
}

describe('Orders webhook registration', () => {
  it('registers the webhook and persists id + secret on successful install', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    mockTokenExchange();
    mockScriptEndpointDefault();
    let hookCalls = 0;
    mockHooksEndpoint(() => {
      hookCalls += 1;
      return HttpResponse.json({
        data: {
          id: 4242,
          scope: 'store/order/created',
          destination: 'https://example.com',
          is_active: true,
        },
      });
    });

    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    const response = await GET(new Request(installUrl()));
    expect(response.status).toBe(200);
    expect(hookCalls).toBe(1);

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    expect(store.ordersWebhookId).toBe(4242);
    expect(store.ordersWebhookSecret).toBeTruthy();
    expect(store.ordersWebhookRegisteredAt).not.toBeNull();
  });

  it('does not re-register once a webhook id is already cached on the store', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    let hookCalls = 0;
    mockHooksEndpoint(() => {
      hookCalls += 1;
      return HttpResponse.json({
        data: { id: 4242, scope: 'store/order/created', destination: 'https://example.com' },
      });
    });

    mockTokenExchange();
    mockScriptEndpointDefault();
    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    await GET(new Request(installUrl()));
    expect(hookCalls).toBe(1);

    mockTokenExchange();
    mockScriptEndpointDefault();
    await GET(new Request(installUrl()));
    expect(hookCalls).toBe(1);
  });

  it('still completes installation successfully even if webhook registration fails', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    mockTokenExchange();
    mockScriptEndpointDefault();
    mockHooksEndpoint(() => HttpResponse.json({ error: 'boom' }, { status: 500 }));

    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    const response = await GET(new Request(installUrl()));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Installation complete');

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    expect(store.ordersWebhookId).toBeNull();
  });

  it('generates and persists a secret even under MOCK_MODE, with a sentinel id and no real network call', async () => {
    // MOCK_MODE stays at its integration-suite default ('true') here — no
    // override, and no hooks-endpoint mock registered. If the MOCK_MODE gate
    // ever regressed to also skip secret generation, this would fail either
    // on a null secret assertion or an MSW "unhandled request" error.
    mockTokenExchange();
    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    const response = await GET(new Request(installUrl()));
    expect(response.status).toBe(200);

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    expect(store.ordersWebhookId).toBe(-1);
    expect(store.ordersWebhookSecret).toBeTruthy();
  });
});
