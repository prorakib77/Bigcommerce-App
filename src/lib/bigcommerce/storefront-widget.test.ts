import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { renderStorefrontWidgetScript } from './storefront-widget';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as {
  JSDOM: new (
    html: string,
    options: { runScripts: 'outside-only'; url: string },
  ) => { window: Window & typeof globalThis };
};

async function flushPromises(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('renderStorefrontWidgetScript', () => {
  it('adds Kickflip selected options as a cart modifier summary', async () => {
    const dom = new JSDOM(
      `
      <form>
        <input name="product_id" value="86" />
        <input name="qty[]" value="2" />
        <div class="form-field">
          <label for="attribute-111">Kickflip design reference</label>
          <input id="attribute-111" name="attribute[111]" value="" />
        </div>
        <div class="form-field">
          <label for="attribute-222">Kickflip selected options</label>
          <textarea id="attribute-222" name="attribute[222]"></textarea>
        </div>
        <div class="form-field">
          <label for="attribute-333">Engraved text</label>
          <input id="attribute-333" name="attribute[333]" required value="test" />
        </div>
        <button id="form-action-addToCart" type="submit">Add to Cart</button>
      </form>
      `,
      { runScripts: 'outside-only', url: 'https://fab-bricks.com/santa-minifig/' },
    );

    const { window } = dom;
    const scriptEl = window.document.createElement('script');
    scriptEl.src =
      'https://bigcommerce-app-ten.vercel.app/api/public/storefront/widget?storeHash=abc123';
    Object.defineProperty(window.document, 'currentScript', {
      configurable: true,
      get: () => scriptEl,
    });

    class NoopMutationObserver {
      observe(): void {
        // no-op
      }
    }

    window.MutationObserver = NoopMutationObserver as unknown as typeof window.MutationObserver;
    window.setInterval = vi.fn(() => 0) as unknown as typeof window.setInterval;
    window.setTimeout = vi.fn(() => 0) as unknown as typeof window.setTimeout;

    const cartBodies: unknown[] = [];
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/api/public/storefront/customize-config')) {
        return Response.json({
          data: {
            enabled: true,
            customizeUrl: 'https://customizer.example.com/embed/abc',
            buttonLabel: 'Customize',
            modifierId: 111,
            summaryModifierId: 222,
          },
        });
      }

      if (url === '/api/storefront/carts' && method === 'GET') {
        return Response.json([]);
      }

      if (url === '/api/storefront/carts' && method === 'POST') {
        cartBodies.push(JSON.parse(String(init?.body)));
        return Response.json({ id: 'cart-1' });
      }

      throw new Error(`Unexpected fetch ${method} ${url}`);
    }) as unknown as typeof window.fetch;

    window.eval(
      renderStorefrontWidgetScript({ appBaseUrl: 'https://bigcommerce-app-ten.vercel.app' }),
    );
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises(4);

    const customizeButton = window.document.querySelector(
      '[data-kickflip-customize-button]',
    ) as HTMLButtonElement | null;
    expect(customizeButton).not.toBeNull();
    customizeButton?.click();

    window.dispatchEvent(
      new window.MessageEvent('message', {
        origin: 'https://customizer.example.com',
        data: {
          eventName: 'mczrAddToCart',
          detail: {
            designId: 'design-123',
            price: 8,
            designImage: 'https://cdn.example.com/design.png',
            configuration: {
              skinTones: { label: 'Skin Tones', value: 'Yellow' },
              face: { label: 'Face', value: 'Lady Lipstick' },
            },
          },
        },
      }),
    );
    await flushPromises(4);

    expect(cartBodies).toEqual([
      {
        lineItems: [
          {
            productId: '86',
            quantity: 2,
            optionSelections: [
              { optionId: 333, optionValue: 'test' },
              { optionId: 111, optionValue: 'design-123' },
              { optionId: 222, optionValue: 'Skin Tones: Yellow\nFace: Lady Lipstick' },
            ],
          },
        ],
      },
    ]);
  });
});
