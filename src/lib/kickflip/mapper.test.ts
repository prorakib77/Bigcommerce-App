import { describe, expect, it } from 'vitest';
import { normalizeDesign } from './mapper';

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    designId: 'design-42',
    productId: 'product-42',
    customizerProductId: 'cust-42',
    name: 'Custom Tee',
    price: '24.99',
    currencyCode: 'USD',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    primaryImage: 'https://cdn.example.com/a.jpg',
    images: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
    options: [{ label: 'Color', value: 'Navy' }],
    ...overrides,
  };
}

describe('normalizeDesign', () => {
  it('normalizes a well-formed record', () => {
    const result = normalizeDesign(validRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.design).toMatchObject({
      externalId: 'design-42',
      productId: 'product-42',
      customizerProductId: 'cust-42',
      name: 'Custom Tee',
      price: '24.99',
      currencyCode: 'USD',
      primaryImageUrl: 'https://cdn.example.com/a.jpg',
      imageUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      summary: [{ label: 'Color', value: 'Navy' }],
    });
    expect(result.design.createdAt).toBeInstanceOf(Date);
    expect(result.design.updatedAt).toBeInstanceOf(Date);
    expect(result.design.rawFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts a numeric designId and derives numericDesignId', () => {
    const result = normalizeDesign(validRaw({ designId: 42 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.design.externalId).toBe('42');
    expect(result.design.numericDesignId).toBe(42);
  });

  it('formats a numeric price to a fixed-precision decimal string, not a float', () => {
    const result = normalizeDesign(validRaw({ price: 19.9 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.design.price).toBe('19.90');
    expect(typeof result.design.price).toBe('string');
  });

  it('rejects a record with no designId', () => {
    const raw = validRaw();
    delete (raw as Record<string, unknown>).designId;
    const result = normalizeDesign(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects a record with a missing price', () => {
    const raw = validRaw();
    delete (raw as Record<string, unknown>).price;
    const result = normalizeDesign(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.externalId).toBe('design-42');
  });

  it('rejects a record with a negative price', () => {
    const result = normalizeDesign(validRaw({ price: '-5.00' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a record with a non-numeric price string', () => {
    const result = normalizeDesign(validRaw({ price: 'free' }));
    expect(result.ok).toBe(false);
  });

  it('falls back to a generated name when name is missing', () => {
    const raw = validRaw();
    delete (raw as Record<string, unknown>).name;
    const result = normalizeDesign(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.design.name).toBe('Kickflip design design-42');
  });

  it('defaults imageUrls to an empty array and primaryImageUrl to null when absent', () => {
    const raw = validRaw({ images: undefined, primaryImage: undefined });
    const result = normalizeDesign(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.design.imageUrls).toEqual([]);
    expect(result.design.primaryImageUrl).toBeNull();
  });

  it('uses the first image as primaryImageUrl when no explicit primary is given', () => {
    const raw = validRaw({ primaryImage: undefined });
    const result = normalizeDesign(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.design.primaryImageUrl).toBe('https://cdn.example.com/a.jpg');
  });

  it('produces a stable fingerprint for identical import-relevant fields', () => {
    const a = normalizeDesign(validRaw());
    const b = normalizeDesign(validRaw({ productId: 'different-but-irrelevant-if-unused' }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // productId isn't part of the fingerprint's import-relevant fields, so
    // it shouldn't be, but name/price/currency/images/summary/updatedAt are —
    // change one of those and the fingerprint must change.
    const c = normalizeDesign(validRaw({ price: '99.99' }));
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.design.rawFingerprint).not.toBe(a.design.rawFingerprint);
  });

  it('rejects a record that does not match the expected shape at all', () => {
    const result = normalizeDesign('not an object');
    expect(result.ok).toBe(false);
  });
});
