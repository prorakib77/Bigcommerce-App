import { describe, expect, it, vi } from 'vitest';
import { computeBackoffDelayMs, computeRateLimitWaitMs } from './backoff';

describe('computeBackoffDelayMs', () => {
  it('doubles the base delay with each attempt, before jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1); // jitter factor = 1 (upper bound)
    expect(computeBackoffDelayMs(1, 100, 10_000)).toBe(100);
    expect(computeBackoffDelayMs(2, 100, 10_000)).toBe(200);
    expect(computeBackoffDelayMs(3, 100, 10_000)).toBe(400);
    vi.restoreAllMocks();
  });

  it('caps the delay at maxDelayMs regardless of attempt number', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(computeBackoffDelayMs(20, 100, 5_000)).toBe(5_000);
    vi.restoreAllMocks();
  });

  it('applies jitter within [0.5x, 1x] of the unjittered delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const min = computeBackoffDelayMs(3, 100, 10_000);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const max = computeBackoffDelayMs(3, 100, 10_000);
    vi.restoreAllMocks();

    expect(min).toBe(200); // 400 * 0.5
    expect(max).toBe(400);
  });

  it('never returns a negative delay for attempt 0', () => {
    expect(computeBackoffDelayMs(0, 100, 10_000)).toBeGreaterThanOrEqual(0);
  });
});

describe('computeRateLimitWaitMs', () => {
  it('honors the server-provided wait when it is longer than the computed backoff', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const wait = computeRateLimitWaitMs(10_000, 1, 100, 5_000, 0);
    vi.restoreAllMocks();
    expect(wait).toBeGreaterThanOrEqual(10_000);
  });

  it('falls back to the computed backoff when it is longer than the server wait', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const wait = computeRateLimitWaitMs(0, 5, 100, 10_000, 0);
    vi.restoreAllMocks();
    expect(wait).toBeGreaterThan(0);
  });

  it('adds jitter on top of the longest applicable wait', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(1).mockReturnValueOnce(0.999);
    const wait = computeRateLimitWaitMs(1_000, 1, 100, 5_000, 500);
    vi.restoreAllMocks();
    expect(wait).toBeGreaterThan(1_000);
    expect(wait).toBeLessThan(1_000 + 500 + 1);
  });

  it('never returns a negative wait for a negative server value', () => {
    expect(computeRateLimitWaitMs(-100, 1, 100, 5_000, 0)).toBeGreaterThanOrEqual(0);
  });
});
