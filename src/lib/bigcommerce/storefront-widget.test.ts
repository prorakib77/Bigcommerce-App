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
        <div class="form-field form-submit-container" data-product-add>
          <label class="form-field-quantity-label">
            Quantity
            <span data-quantity-control="86">
              <input name="qty[]" value="2" />
            </span>
          </label>
          <button id="form-action-addToCart" type="submit">Add to Cart</button>
        </div>
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
    const addToCartButton = window.document.querySelector(
      '#form-action-addToCart',
    ) as HTMLButtonElement | null;
    const quantityLabel = window.document.querySelector(
      '.form-field-quantity-label',
    ) as HTMLElement | null;
    expect(customizeButton).not.toBeNull();
    expect(customizeButton?.parentElement?.tagName).toBe('FORM');
    expect(customizeButton?.style.display).toBe('block');
    expect(addToCartButton?.style.display).toBe('none');
    expect(quantityLabel?.style.display).toBe('none');
    customizeButton?.click();

    window.dispatchEvent(
      new window.MessageEvent('message', {
        origin: 'https://customizer.example.com',
        data: {
          eventName: 'mczrAddToCart',
          detail: {
            designId: 'design-123',
            price: 0,
            designImage: 'https://cdn.example.com/design.png',
            summary: [
              { key: 'Skin Tones', value: 'Yellow' },
              { key: 'Face', value: 'Lady Lipstick' },
              { key: 'Brick 1 Text 2x4', value: '' },
            ],
            configuration: {
              'QUESTION-abc': 'ANSWER-def',
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
              {
                optionId: 222,
                optionValue:
                  'Skin Tones: Yellow\nFace: Lady Lipstick\nBrick 1 Text 2x4: Untitled answer',
              },
            ],
          },
        ],
      },
    ]);
  });

  it('uses the priced cart relay when Kickflip returns a price adjustment', async () => {
    const dom = new JSDOM(
      `
      <form>
        <input name="product_id" value="86" />
        <input name="variant_id" value="701" />
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
        <div class="form-field form-submit-container" data-product-add>
          <input name="qty[]" value="3" />
          <button id="form-action-addToCart" type="submit">Add to Cart</button>
        </div>
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

    const pricedBodies: unknown[] = [];
    const storefrontPosts: unknown[] = [];
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
        return Response.json({ id: '11111111-1111-1111-1111-111111111111' });
      }

      if (url.includes('/api/public/storefront/priced-cart') && method === 'POST') {
        pricedBodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          data: {
            cartId: '11111111-1111-1111-1111-111111111111',
            cartUrl:
              'https://fab-bricks.com/cart.php?action=load&id=11111111-1111-1111-1111-111111111111',
            finalUnitPrice: '10.50',
          },
        });
      }

      if (url.includes('/api/storefront/carts') && method === 'POST') {
        storefrontPosts.push(JSON.parse(String(init?.body)));
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
    customizeButton?.click();

    window.dispatchEvent(
      new window.MessageEvent('message', {
        origin: 'https://customizer.example.com',
        data: {
          eventName: 'mczrAddToCart',
          detail: {
            designId: 'design-123',
            price: 2.5,
            summary: [{ key: 'Skin Tones', value: 'Yellow' }],
          },
        },
      }),
    );
    await flushPromises(4);

    expect(pricedBodies).toEqual([
      {
        storeHash: 'abc123',
        productId: 86,
        variantId: 701,
        cartId: '11111111-1111-1111-1111-111111111111',
        quantity: 3,
        kickflipPriceAdjustment: '2.50',
        optionSelections: [
          { optionId: 333, optionValue: 'test' },
          { optionId: 111, optionValue: 'design-123' },
          { optionId: 222, optionValue: 'Skin Tones: Yellow' },
        ],
      },
    ]);
    expect(storefrontPosts).toEqual([]);
  });

  it('formats Kickflip cart metadata as visible question answer rows', async () => {
    const dom = new JSDOM(
      `
      <main>
        <dl class="cart-item-options">
          <dt>Engraved text: </dt>
          <dd>test</dd>
          <dt>Kickflip design reference: </dt>
          <dd>17</dd>
          <dt>Kickflip selected options: </dt>
          <dd>Skin Tones: Yellow
Face: Lady Lipstick
QUESTION-abc: ANSWER-def
key: Brick 1 Text 2x4</dd>
        </dl>
      </main>
      `,
      { runScripts: 'outside-only', url: 'https://fab-bricks.com/cart.php' },
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

    window.eval(
      renderStorefrontWidgetScript({ appBaseUrl: 'https://bigcommerce-app-ten.vercel.app' }),
    );
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushPromises(4);

    const labels = Array.from(window.document.querySelectorAll('dt')).map((el) => ({
      text: el.textContent?.trim(),
      display: (el as HTMLElement).style.display,
    }));
    const values = Array.from(window.document.querySelectorAll('dd')).map((el) => ({
      text: el.textContent?.replace(/\s+/g, ' ').trim(),
      display: (el as HTMLElement).style.display,
    }));
    const rows = Array.from(
      window.document.querySelectorAll('[data-kickflip-selection-list] div'),
    ).map((el) => el.textContent);

    expect(labels).toEqual([
      { text: 'Engraved text:', display: '' },
      { text: 'Kickflip design reference:', display: 'none' },
      { text: 'Kickflip selected options:', display: 'none' },
    ]);
    expect(values[1]).toEqual({ text: '17', display: 'none' });
    expect(rows).toEqual([
      'Skin Tones: Yellow',
      'Face: Lady Lipstick',
      'Brick 1 Text 2x4: Untitled answer',
    ]);
  });
});
