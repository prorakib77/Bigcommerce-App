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
// off — ensureStorefrontScriptRegistered's MOCK_MODE gate (required so the
// rest of the integration suite, which runs with MOCK_MODE=true, never
// makes a real/unmocked Script Manager call) is exactly what these tests
// exist to bypass and exercise directly.
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
        scope: 'store_v2_products store_v2_content',
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

function mockScriptEndpoint(handler: () => Response) {
  mswServer.use(
    http.post(`${getEnv().BIGCOMMERCE_API_BASE_URL}/stores/teststore1/v3/content/scripts`, handler),
  );
}

function mockScriptUpdateEndpoint(handler: (uuid: string) => Response) {
  mswServer.use(
    http.put(
      `${getEnv().BIGCOMMERCE_API_BASE_URL}/stores/teststore1/v3/content/scripts/:uuid`,
      ({ params }) => handler(String(params.uuid)),
    ),
  );
}

// The install route also calls ensureOrdersWebhookRegistered right after
// ensureStorefrontScriptRegistered (see src/app/api/bigcommerce/auth/route.ts).
// With MOCK_MODE=false, that makes a second real outbound call this file
// must mock too, or MSW's onUnhandledRequest:'error' fails these tests for
// a reason unrelated to what they're actually testing. Orders-webhook
// registration itself is covered by its own dedicated test file
// (orders-webhook-registration.test.ts) — this default handler just needs
// to not blow up.
function mockHooksEndpointDefault(): void {
  mswServer.use(
    http.post(`${getEnv().BIGCOMMERCE_API_BASE_URL}/stores/teststore1/v3/hooks`, () =>
      HttpResponse.json({
        data: { id: 1, scope: 'store/order/created', destination: 'https://example.com' },
      }),
    ),
  );
}

describe('Storefront Customize widget script registration', () => {
  it('registers the script and persists the uuid on successful install', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    mockTokenExchange();
    mockHooksEndpointDefault();
    let scriptCalls = 0;
    mockScriptEndpoint(() => {
      scriptCalls += 1;
      return HttpResponse.json({ data: { uuid: 'script-uuid-1', name: 'Customize widget' } });
    });

    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    const response = await GET(new Request(installUrl()));
    expect(response.status).toBe(200);
    expect(scriptCalls).toBe(1);

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    expect(store.storefrontScriptUuid).toBe('script-uuid-1');
    expect(store.storefrontScriptRegisteredAt).not.toBeNull();
  });

  it('updates (not re-creates) the script once a uuid is already cached on the store', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    let createCalls = 0;
    mockScriptEndpoint(() => {
      createCalls += 1;
      return HttpResponse.json({ data: { uuid: 'script-uuid-1', name: 'Customize widget' } });
    });

    mockTokenExchange();
    mockHooksEndpointDefault();
    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    await GET(new Request(installUrl()));
    expect(createCalls).toBe(1);

    // Second install (e.g. an uninstall/reinstall cycle) with the uuid
    // already cached from the first — must PUT (backfill consent_category
    // on the existing script) rather than POST a duplicate.
    let updateCalls = 0;
    let updatedUuid: string | undefined;
    mockScriptUpdateEndpoint((uuid): Response => {
      updateCalls += 1;
      updatedUuid = uuid;
      return HttpResponse.json({ data: { uuid, name: 'Customize widget' } });
    });

    mockTokenExchange();
    mockHooksEndpointDefault();
    await GET(new Request(installUrl()));
    expect(createCalls).toBe(1);
    expect(updateCalls).toBe(1);
    expect(updatedUuid).toBe('script-uuid-1');
  });

  it('still completes installation successfully even if script registration fails', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    mockTokenExchange();
    mockHooksEndpointDefault();
    mockScriptEndpoint(() => HttpResponse.json({ error: 'boom' }, { status: 500 }));

    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    const response = await GET(new Request(installUrl()));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Installation complete');

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    expect(store.storefrontScriptUuid).toBeNull();
  });

  it('does not call Script Manager at all when MOCK_MODE is enabled (regression guard)', async () => {
    // MOCK_MODE stays at its integration-suite default ('true') here — no
    // override. If ensureStorefrontScriptRegistered's gate ever regressed,
    // this would fail with an MSW "unhandled request" error instead of a
    // normal assertion failure, since no script-endpoint handler is
    // registered in this test.
    mockTokenExchange();
    const { GET } = await import('@/app/api/bigcommerce/auth/route');
    const response = await GET(new Request(installUrl()));
    expect(response.status).toBe(200);

    const store = await prisma.store.findUniqueOrThrow({ where: { storeHash: 'teststore1' } });
    expect(store.storefrontScriptUuid).toBeNull();
  });
});
