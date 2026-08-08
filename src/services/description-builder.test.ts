import { describe, expect, it } from 'vitest';
import { buildProductDescriptionHtml } from './description-builder';
import type { NormalizedKickflipDesign } from '@/lib/kickflip';

function design(overrides: Partial<NormalizedKickflipDesign> = {}): NormalizedKickflipDesign {
  return {
    externalId: 'design-1',
    numericDesignId: 1,
    productId: null,
    customizerProductId: null,
    name: 'Custom Tee',
    price: '19.99',
    currencyCode: 'USD',
    createdAt: null,
    updatedAt: null,
    primaryImageUrl: null,
    imageUrls: [],
    summary: [{ label: 'Color', value: 'Navy' }],
    rawFingerprint: 'abc',
    ...overrides,
  };
}

describe('buildProductDescriptionHtml', () => {
  it('includes the design name and summary entries', () => {
    const html = buildProductDescriptionHtml(design());
    expect(html).toContain('Custom Tee');
    expect(html).toContain('Color');
    expect(html).toContain('Navy');
  });

  it('only emits the allowlisted tags', () => {
    const html = buildProductDescriptionHtml(design());
    expect(html).toMatch(/^<p>/);
    expect(html).not.toMatch(/<(script|iframe|img|a|div|span)[ >]/i);
  });

  it('strips script tags injected via a design field', () => {
    const html = buildProductDescriptionHtml(design({ name: '<script>alert(1)</script>Evil Tee' }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('strips event-handler attributes injected via a summary value', () => {
    const html = buildProductDescriptionHtml(
      design({ summary: [{ label: 'Note', value: '<img src=x onerror=alert(1)>' }] }),
    );
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('omits the summary list entirely when there is no summary', () => {
    const html = buildProductDescriptionHtml(design({ summary: [] }));
    expect(html).not.toContain('<ul>');
  });

  it('caps the number of summary rows rendered', () => {
    const bigSummary = Array.from({ length: 50 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
    const html = buildProductDescriptionHtml(design({ summary: bigSummary }));
    const matches = html.match(/<li>/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(20);
  });
});
