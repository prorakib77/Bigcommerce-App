import { afterEach, describe, expect, it } from 'vitest';
import { __resetEnvCacheForTests } from '@/server/env';
import { encodeCategoryIds, decodeCategoryIds } from './settings-repository';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

afterEach(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  __resetEnvCacheForTests();
});

describe('decodeCategoryIds', () => {
  it('passes a native array straight through (the Postgres shape)', () => {
    expect(decodeCategoryIds([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('parses a JSON-encoded array (the SQLite shape)', () => {
    expect(decodeCategoryIds('[4,5,6]')).toEqual([4, 5, 6]);
  });

  it('returns an empty array for an empty JSON array string', () => {
    expect(decodeCategoryIds('[]')).toEqual([]);
  });

  it('falls back to an empty array for malformed JSON rather than throwing', () => {
    expect(decodeCategoryIds('not json')).toEqual([]);
  });

  it('falls back to an empty array when the parsed JSON is not an array', () => {
    expect(decodeCategoryIds('{"not":"an array"}')).toEqual([]);
  });

  it('falls back to an empty array for null/undefined/other types', () => {
    expect(decodeCategoryIds(null)).toEqual([]);
    expect(decodeCategoryIds(undefined)).toEqual([]);
    expect(decodeCategoryIds(42)).toEqual([]);
  });
});

describe('encodeCategoryIds', () => {
  it('keeps a native number[] when the backend is Postgres', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5544/test?schema=public';
    __resetEnvCacheForTests();
    expect(encodeCategoryIds([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('JSON-encodes to a string when the backend is SQLite', () => {
    process.env.DATABASE_URL = 'file:./should-not-be-created.db';
    __resetEnvCacheForTests();
    expect(encodeCategoryIds([1, 2, 3])).toBe('[1,2,3]');
  });

  it('round-trips through encode -> decode for both backends', () => {
    for (const url of [
      'postgresql://test:test@localhost:5544/test?schema=public',
      'file:./should-not-be-created.db',
    ]) {
      process.env.DATABASE_URL = url;
      __resetEnvCacheForTests();
      const encoded = encodeCategoryIds([7, 8, 9]);
      expect(decodeCategoryIds(encoded)).toEqual([7, 8, 9]);
    }
  });
});
