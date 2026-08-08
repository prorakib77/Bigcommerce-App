import { describe, expect, it } from 'vitest';
import { selectClaimable, decideRetryOutcome } from './sqlite-queue';

describe('selectClaimable', () => {
  it('claims up to freeSlots candidates when there is no group cap', () => {
    const candidates = [
      { id: '1', groupId: 'store-a' },
      { id: '2', groupId: 'store-b' },
      { id: '3', groupId: 'store-c' },
    ];
    const claimed = selectClaimable(candidates, 2, Infinity);
    expect(claimed.map((c) => c.id)).toEqual(['1', '2']);
  });

  it('never claims more than one job per group beyond the group limit, within one batch', () => {
    const candidates = [
      { id: '1', groupId: 'store-a' },
      { id: '2', groupId: 'store-a' },
      { id: '3', groupId: 'store-a' },
      { id: '4', groupId: 'store-b' },
    ];
    // groupLimit=1 means at most one job per store per tick, even though
    // freeSlots=10 would otherwise allow claiming everything.
    const claimed = selectClaimable(candidates, 10, 1);
    expect(claimed.map((c) => c.id)).toEqual(['1', '4']);
  });

  it('respects a group limit greater than one', () => {
    const candidates = [
      { id: '1', groupId: 'store-a' },
      { id: '2', groupId: 'store-a' },
      { id: '3', groupId: 'store-a' },
    ];
    const claimed = selectClaimable(candidates, 10, 2);
    expect(claimed.map((c) => c.id)).toEqual(['1', '2']);
  });

  it('returns nothing when there are no free slots', () => {
    const candidates = [{ id: '1', groupId: 'store-a' }];
    expect(selectClaimable(candidates, 0, Infinity)).toEqual([]);
  });

  it('preserves candidate order (oldest-first) among claimed jobs', () => {
    const candidates = [
      { id: 'old', groupId: 'store-a' },
      { id: 'new', groupId: 'store-b' },
    ];
    const claimed = selectClaimable(candidates, 5, Infinity);
    expect(claimed.map((c) => c.id)).toEqual(['old', 'new']);
  });
});

describe('decideRetryOutcome', () => {
  it('retries when under the retry limit, computing a positive backoff delay', () => {
    const outcome = decideRetryOutcome(0, 5, 1_000, 60_000);
    expect(outcome.action).toBe('retry');
    if (outcome.action === 'retry') {
      expect(outcome.retryCount).toBe(1);
      expect(outcome.delayMs).toBeGreaterThan(0);
      expect(outcome.delayMs).toBeLessThanOrEqual(60_000);
    }
  });

  it('fails permanently once the retry count reaches the limit', () => {
    const outcome = decideRetryOutcome(4, 5, 1_000, 60_000);
    expect(outcome).toEqual({ action: 'fail', retryCount: 5 });
  });

  it('fails permanently if already at or past the limit (defensive)', () => {
    const outcome = decideRetryOutcome(5, 5, 1_000, 60_000);
    expect(outcome.action).toBe('fail');
  });

  it('never exceeds maxDelayMs even for a high retry count', () => {
    const outcome = decideRetryOutcome(9, 20, 1_000, 10_000);
    expect(outcome.action).toBe('retry');
    if (outcome.action === 'retry') {
      expect(outcome.delayMs).toBeLessThanOrEqual(10_000);
    }
  });
});
