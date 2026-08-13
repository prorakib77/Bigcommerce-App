import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/mocks/server';
import { resetDatabase } from '@/test/helpers/db-reset';
import { prisma } from '@/server/db/prisma';
import { getEnv, __resetEnvCacheForTests } from '@/server/env';
import { seedStore } from '@/test/factories/store-factory';
import { ensureDesignReferenceModifier } from '@/services/product-customize-service';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
beforeEach(() => resetDatabase());

// Same reasoning as storefront-script-registration.test.ts: this is the one
// file that legitimately needs MOCK_MODE off, since ensureDesignReferenceModifier's
// MOCK_MODE gate is exactly what these tests exist to bypass and exercise
// directly. Calls the service function directly rather than through the PUT
// /customize route — that route wires this in fire-and-forget (same as the
// script self-heal it sits next to), so awaiting the HTTP response doesn't
// reliably wait for this to settle.
const ORIGINAL_MOCK_MODE = process.env.MOCK_MODE;
afterEach(() => {
  process.env.MOCK_MODE = ORIGINAL_MOCK_MODE;
  __resetEnvCacheForTests();
});

async function seedEnabledConfig(storeId: string, bigcommerceProductId: number) {
  return prisma.productCustomizeConfig.create({
    data: {
      storeId,
      bigcommerceProductId,
      enabled: true,
      customizeUrl: 'https://customizer.example.com/embed/abc',
      buttonLabel: 'Customize',
    },
  });
}

function mockModifierEndpoint(storeHash: string, productId: number, handler: () => Response) {
  mswServer.use(
    http.post(
      `${getEnv().BIGCOMMERCE_API_BASE_URL}/stores/${storeHash}/v3/catalog/products/${productId}/modifiers`,
      handler,
    ),
  );
}

describe('ensureDesignReferenceModifier', () => {
  it('creates the cart metadata modifiers and persists their ids when none are registered yet', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    const { store } = await seedStore();
    const config = await seedEnabledConfig(store.id, 100050);

    let calls = 0;
    mockModifierEndpoint(store.storeHash, 100050, () => {
      calls += 1;
      return HttpResponse.json({
        data: {
          id: calls === 1 ? 555 : 556,
          display_name: calls === 1 ? 'Kickflip design reference' : 'Kickflip selected options',
          type: 'text',
        },
      });
    });

    await ensureDesignReferenceModifier(store, config, 'corr-1');
    expect(calls).toBe(2);

    const updated = await prisma.productCustomizeConfig.findUniqueOrThrow({
      where: { id: config.id },
    });
    expect(updated.kickflipModifierId).toBe(555);
    expect(updated.kickflipSummaryModifierId).toBe(556);
  });

  it('only registers the missing summary modifier when the design modifier id is already cached', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    const { store } = await seedStore();
    const config = await prisma.productCustomizeConfig.create({
      data: {
        storeId: store.id,
        bigcommerceProductId: 100051,
        enabled: true,
        customizeUrl: 'https://customizer.example.com/embed/abc',
        buttonLabel: 'Customize',
        kickflipModifierId: 999,
      },
    });

    let calls = 0;
    mockModifierEndpoint(store.storeHash, 100051, () => {
      calls += 1;
      return HttpResponse.json({ data: { id: 777 } });
    });

    await ensureDesignReferenceModifier(store, config, 'corr-2');
    expect(calls).toBe(1);

    const unchanged = await prisma.productCustomizeConfig.findUniqueOrThrow({
      where: { id: config.id },
    });
    expect(unchanged.kickflipModifierId).toBe(999);
    expect(unchanged.kickflipSummaryModifierId).toBe(777);
  });

  it('does not re-register once both modifier ids are already cached', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    const { store } = await seedStore();
    const config = await prisma.productCustomizeConfig.create({
      data: {
        storeId: store.id,
        bigcommerceProductId: 100055,
        enabled: true,
        customizeUrl: 'https://customizer.example.com/embed/abc',
        buttonLabel: 'Customize',
        kickflipModifierId: 999,
        kickflipSummaryModifierId: 1000,
      },
    });

    let calls = 0;
    mockModifierEndpoint(store.storeHash, 100055, () => {
      calls += 1;
      return HttpResponse.json({ data: { id: 777 } });
    });

    await ensureDesignReferenceModifier(store, config, 'corr-6');
    expect(calls).toBe(0);

    const unchanged = await prisma.productCustomizeConfig.findUniqueOrThrow({
      where: { id: config.id },
    });
    expect(unchanged.kickflipModifierId).toBe(999);
    expect(unchanged.kickflipSummaryModifierId).toBe(1000);
  });

  it('does not register a modifier for a disabled config', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    const { store } = await seedStore();
    const config = await prisma.productCustomizeConfig.create({
      data: {
        storeId: store.id,
        bigcommerceProductId: 100052,
        enabled: false,
        customizeUrl: null,
        buttonLabel: 'Customize',
      },
    });

    let calls = 0;
    mockModifierEndpoint(store.storeHash, 100052, () => {
      calls += 1;
      return HttpResponse.json({ data: { id: 1 } });
    });

    await ensureDesignReferenceModifier(store, config, 'corr-3');
    expect(calls).toBe(0);

    const unchanged = await prisma.productCustomizeConfig.findUniqueOrThrow({
      where: { id: config.id },
    });
    expect(unchanged.kickflipModifierId).toBeNull();
    expect(unchanged.kickflipSummaryModifierId).toBeNull();
  });

  it('propagates a BigCommerce failure to the caller rather than swallowing it', async () => {
    process.env.MOCK_MODE = 'false';
    __resetEnvCacheForTests();

    const { store } = await seedStore();
    const config = await seedEnabledConfig(store.id, 100053);

    mockModifierEndpoint(store.storeHash, 100053, () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    );

    await expect(ensureDesignReferenceModifier(store, config, 'corr-4')).rejects.toThrow();

    const unchanged = await prisma.productCustomizeConfig.findUniqueOrThrow({
      where: { id: config.id },
    });
    expect(unchanged.kickflipModifierId).toBeNull();
    expect(unchanged.kickflipSummaryModifierId).toBeNull();
  });

  it('does nothing at all when MOCK_MODE is enabled (regression guard)', async () => {
    // MOCK_MODE stays at its integration-suite default ('true') here — no
    // override. If the MOCK_MODE gate ever regressed, this would fail with
    // an MSW "unhandled request" error instead of a normal assertion
    // failure, since no modifier-endpoint handler is registered in this test.
    const { store } = await seedStore();
    const config = await seedEnabledConfig(store.id, 100054);

    await ensureDesignReferenceModifier(store, config, 'corr-5');

    const unchanged = await prisma.productCustomizeConfig.findUniqueOrThrow({
      where: { id: config.id },
    });
    expect(unchanged.kickflipModifierId).toBeNull();
    expect(unchanged.kickflipSummaryModifierId).toBeNull();
  });
});
