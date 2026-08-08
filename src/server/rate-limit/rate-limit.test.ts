import { describe, expect, it, beforeEach } from 'vitest';
import { assertWithinRateLimit, checkRateLimit, resetRateLimitStoreForTests } from './index';
import { AppError } from '@/server/errors/app-error';

beforeEach(() => {
  resetRateLimitStoreForTests();
});

describe('checkRateLimit', () => {
  it('allows requests up to the configured max within the window', () => {
    const key = 'test-key-1';
    for (let i = 0; i < 5; i += 1) {
      expect(checkRateLimit(key, 60_000, 5).allowed).toBe(true);
    }
  });

  it('blocks the request that exceeds the max within the window', () => {
    const key = 'test-key-2';
    for (let i = 0; i < 5; i += 1) checkRateLimit(key, 60_000, 5);
    const result = checkRateLimit(key, 60_000, 5);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('tracks separate budgets per key', () => {
    for (let i = 0; i < 5; i += 1) checkRateLimit('key-a', 60_000, 5);
    expect(checkRateLimit('key-a', 60_000, 5).allowed).toBe(false);
    expect(checkRateLimit('key-b', 60_000, 5).allowed).toBe(true);
  });
});

describe('assertWithinRateLimit', () => {
  it('throws a RATE_LIMITED AppError once the budget is exhausted', () => {
    const key = 'assert-key';
    for (let i = 0; i < 3; i += 1) assertWithinRateLimit(key, 60_000, 3);
    expect(() => assertWithinRateLimit(key, 60_000, 3)).toThrow(AppError);
    try {
      assertWithinRateLimit(key, 60_000, 3);
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('RATE_LIMITED');
    }
  });
});
