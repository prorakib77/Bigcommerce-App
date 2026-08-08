import { describe, expect, it } from 'vitest';
import { kickflipDesignsResponseSchema } from './schemas';

describe('kickflipDesignsResponseSchema', () => {
  it('parses the real API envelope (confirmed 2026-08-02 against gokickflip.com)', () => {
    const real = {
      pagination: {
        collectionSize: 0,
        resultSize: 0,
        lastIndex: 0,
        sortOrder: 'descending',
        sortKey: 'designId',
      },
      results: [],
    };
    const parsed = kickflipDesignsResponseSchema.safeParse(real);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.results).toEqual([]);
      expect(parsed.data.pagination?.collectionSize).toBe(0);
    }
  });

  it('parses a populated real-shape envelope', () => {
    const real = {
      pagination: {
        collectionSize: 3,
        resultSize: 2,
        lastIndex: 1,
        sortOrder: 'descending',
        sortKey: 'designId',
      },
      results: [{ designId: 'a' }, { designId: 'b' }],
    };
    const parsed = kickflipDesignsResponseSchema.safeParse(real);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.results).toHaveLength(2);
    }
  });

  it('still tolerates the originally-assumed cursor-based shape', () => {
    const assumed = { data: [{ designId: 'a' }], cursor: 'next-page-token', hasMore: true };
    const parsed = kickflipDesignsResponseSchema.safeParse(assumed);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.data).toHaveLength(1);
      expect(parsed.data.cursor).toBe('next-page-token');
    }
  });

  it('rejects a response with neither "results" nor "data"', () => {
    const parsed = kickflipDesignsResponseSchema.safeParse({ pagination: {} });
    expect(parsed.success).toBe(false);
  });
});
